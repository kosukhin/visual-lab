import './style.css';
import { DemoBrain } from './ai/demo-brain';
import { describeError, detectNano, type NanoEnvironment } from './ai/gemini-nano';
import {
  DEFAULT_LOCAL_MODEL,
  clearLocalModelFlag,
  formatBytes,
  inspectLocalModel,
  localModelUrl,
  readLocalModelFlag,
  removeLocalModel,
  storageEstimate,
  writeLocalModelFlag,
} from './ai/local-model';
import { NanoBrain } from './ai/nano-brain';
import { VizDatabase } from './db/database';
import {
  FileStorage,
  IdbStorage,
  hasPermission,
  loadRememberedHandle,
  pickExistingDatabaseFile,
  pickNewDatabaseFile,
  requestPermission,
  supportsFileSystemAccess,
  type DbStorage,
} from './db/storage';
import { registerServiceWorker } from './pwa';
import type { BrainKind, ConductorBrain, ConductorStatus, Visualization } from './types';
import { ChatPanel } from './ui/chat';
import { GalleryPanel, plural } from './ui/gallery';
import { Hud } from './ui/hud';
import { SetupDialog, type DbState, type LocalState, type ModelState } from './ui/setup-dialog';
import { World } from './world/world';

/**
 * Точка сборки приложения:
 * мир ↔ проводник (Gemini Nano) ↔ база SQLite ↔ интерфейс.
 */

const db = new VizDatabase();
/** Пресет локальной модели (GGUF, wllama). */
const localModel = DEFAULT_LOCAL_MODEL;

let world: World;
let hud: Hud;
let chat: ChatPanel;
let setup: SetupDialog;
let gallery: GalleryPanel;

let brain: ConductorBrain | null = null;
let nanoEnv: NanoEnvironment | null = null;
let rememberedHandle: FileSystemFileHandle | null = null;
let dbReady = false;
let entered = false;
let greeted = false;
let busy = false;

const modelState: ModelState = {
  badge: 'проверяю…',
  tone: 'neutral',
  note: 'Смотрю, доступна ли Gemini Nano в браузере…',
  downloadVisible: false,
  downloadLabel: 'Скачать модель Gemini Nano',
  demoVisible: true,
  demoLabel: 'Демо-режим без ИИ',
  progress: null,
  hint: null,
  recheckVisible: false,
};

const localState: LocalState = {
  badge: 'проверяю…',
  tone: 'neutral',
  note: 'Смотрю, есть ли локальная модель в кэше…',
  downloadVisible: false,
  downloadLabel: 'Скачать модель',
  useVisible: false,
  useLabel: 'Подключить',
  deleteVisible: false,
  progress: null,
  hint: null,
};

const dbState: DbState = {
  badge: 'файл не выбран',
  tone: 'neutral',
  note: 'Мне нужно место для визуализаций. Выберите файл базы на компьютере — я могу создать новый или открыть уже существующий.',
  createLabel: 'Создать новую базу',
  openLabel: 'Открыть существующую',
  resumeLabel: null,
  idbLabel: 'Хранить в браузере',
};

/**
 * Единая точка смены движка: обновляет HUD, шапку чата и подписи под ответами,
 * чтобы пользователь всегда видел, кто именно отвечает.
 */
function applyEngine(kind: BrainKind, label: string, announce = false): void {
  hud.setEngine(kind, label);
  chat.setEngine(kind, label);
  // подпись над проводником в 3D — чтобы и в мире было видно, кто отвечает
  world.setConductorName(
    kind === 'nano' ? 'Gemini Nano' : kind === 'local' ? localModel.shortLabel : 'Демо-режим',
  );
  if (announce) {
    hud.toast(
      kind === 'nano'
        ? 'Проводник работает на Gemini Nano'
        : kind === 'local'
          ? `Проводник переключился на локальную модель: ${label}`
          : 'Проводник переключился в демо-режим (без ИИ)',
    );
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Не найден элемент #${id}`);
  return element as T;
}

const NANO_ENABLE_HINT = `
  <ol>
    <li>Откройте <code>chrome://flags/#prompt-api-for-gemini-nano</code> и включите <b>Enabled</b>.</li>
    <li>Откройте <code>chrome://flags/#optimization-guide-on-device-model</code> и выберите
      <b>Enabled BypassPerfRequirement</b>.</li>
    <li>Перезапустите Chrome.</li>
    <li>Откройте <code>chrome://components</code>, найдите «Optimization Guide On Device Model»
      и нажмите <b>Check for update</b> — так скачивается сама модель (~2–4 ГБ, нужно ~22 ГБ свободного места).</li>
    <li>Проверьте <code>chrome://on-device-internals</code> → вкладка <b>Broker State</b>: ошибок быть не должно.</li>
    <li>Вернитесь сюда и нажмите «Проверить снова».</li>
  </ol>
  <p style="margin:8px 0 0">Модель требует современный десктопный Chrome: 4+ ГБ видеопамяти
  (или 16+ ГБ ОЗУ), свободное место и включённые флаги выше. В остальных случаях доступен
  демо-режим — 3D, SQLite и галерея работают без ИИ.</p>
`;

function patchModel(patch: Partial<ModelState>): void {
  Object.assign(modelState, patch);
  setup.setModelState(modelState);
}

function patchLocal(patch: Partial<LocalState>): void {
  Object.assign(localState, patch);
  setup.setLocalState(localState);
}

function patchDb(patch: Partial<DbState>): void {
  Object.assign(dbState, patch);
  setup.setDbState(dbState);
}

/* ------------------------------------------------------------- запуск ---- */

async function boot(): Promise<void> {
  registerServiceWorker();

  const uiRoot = byId('ui-root');
  const viewport = byId('viewport');

  world = new World(viewport, {
    onLockChange: (locked) => {
      hud.setCrosshairVisible(locked);
    },
    onLockError: () => {
      hud.toast('Браузер не дал захватить мышь — кликните по миру ещё раз', 'error');
      hud.setHint('Клик по миру — захватить мышь · T — чат · G — галерея');
    },
  });

  hud = new Hud(uiRoot);
  chat = new ChatPanel(uiRoot, {
    onSubmit: (text) => void handleSubmit(text),
    onFocusChange: (focused) => {
      if (focused) world.unlock();
    },
    onShowVisualization: (id) => showSavedVisualization(id),
  });
  gallery = new GalleryPanel(uiRoot, {
    onShow: (id) => {
      showSavedVisualization(id);
      gallery.close();
    },
    onDelete: (id) => deleteVisualization(id),
    onClose: () => gallery.close(),
  });
  setup = new SetupDialog(uiRoot, {
    onDownloadModel: () => void downloadModel(),
    onUseDemo: () => activateDemo(),
    onRecheckModel: () => void recheckModel(),
    onCreateDatabase: () => void createDatabase(),
    onOpenDatabase: () => void openExistingDatabase(),
    onResumeDatabase: () => void resumeDatabase(),
    onCreateIdbDatabase: () => void createIdbDatabase(),
    onDownloadLocalModel: () => void downloadLocalModel(),
    onUseLocalModel: () => void attachLocalBrain(),
    onDeleteLocalModel: () => void deleteLocalModel(),
    onEnter: () => enterWorld(),
  });

  hud.onAction((action) => {
    if (action === 'gallery') toggleGallery();
    if (action === 'database') openSetup();
    if (action === 'help') showHelp();
  });

  world.start();
  bindShortcuts();

  chat.setEnabled(false);
  chat.setMode('проверяю модель…');

  await initModel();
  await initStorage();
  await initLocalModel();

  setup.show();
  hideBootScreen();
}

function hideBootScreen(): void {
  const boot = document.getElementById('boot-screen');
  if (!boot) return;
  boot.classList.add('is-hidden');
  window.setTimeout(() => boot.remove(), 600);
}

/** Перепроверка модели без перезагрузки страницы (после включения флагов Chrome). */
async function recheckModel(): Promise<void> {
  setup.setError(null);
  setup.setBusy('download', true);
  try {
    await initModel();
    if (brain?.kind === 'nano') {
      hud.toast('Gemini Nano доступна — проводник на связи');
    } else {
      hud.toast('Модель пока недоступна: включите флаги и скачайте её в chrome://components', 'error');
    }
  } finally {
    setup.setBusy('download', false);
  }
}

async function initModel(): Promise<void> {
  const env = await detectNano();
  nanoEnv = env;

  if (env.availability === 'available') {
    if (brain?.kind !== 'nano') {
      brain?.dispose();
      brain = new NanoBrain({ languages: env.languages });
    }
    applyEngine('nano', 'Gemini Nano');
    chat.setMode('Gemini Nano · на связи');
    chat.setEnabled(true);
    patchModel({
      badge: 'готова',
      tone: 'good',
      note: `Gemini Nano уже установлена — проводник полностью работает.${languageHint(env)}`,
      downloadVisible: false,
      demoVisible: true,
      demoLabel: 'Демо-режим без ИИ',
      progress: null,
      hint: null,
      recheckVisible: false,
    });
    return;
  }

  hud.setEnginePending(env.supported ? 'Модель не установлена' : 'Модель недоступна');
  chat.setEnabled(false);
  chat.setMode(
    env.availability === 'unavailable' ? 'Gemini Nano недоступна' : 'Gemini Nano не установлена',
  );

  if (!env.supported) {
    patchModel({
      badge: 'недоступна',
      tone: 'bad',
      note: `${env.note} Проводник переключится в демо-режим: шаблонные визуализации, но всё остальное работает как обычно.`,
      downloadVisible: false,
      demoVisible: false,
      progress: null,
      hint: NANO_ENABLE_HINT,
      recheckVisible: true,
    });
    activateDemo();
    return;
  }

  const downloading = env.availability === 'downloading';
  const downloadable = env.availability === 'downloadable' || downloading;
  patchModel({
    badge: downloading ? 'скачивается' : downloadable ? 'не установлена' : 'недоступна',
    tone: downloading ? 'warn' : downloadable ? 'neutral' : 'bad',
    note: downloadable
      ? `${env.note} Модель скачивается один раз, дальше работает офлайн.${languageHint(env)}`
      : env.note,
    // скачивать можно только если Chrome сам говорит «downloadable/downloading»
    downloadVisible: downloadable,
    downloadLabel: downloading ? 'Продолжить загрузку' : 'Скачать модель Gemini Nano',
    demoVisible: true,
    progress: null,
    hint: downloading ? null : NANO_ENABLE_HINT,
    recheckVisible: true,
  });
}

/* --------------------------------------------------------------- модель --- */

/** Chrome официально поддерживает ограниченный набор языков модели. */
const NANO_OFFICIAL_LANGUAGES = ['de', 'en', 'es', 'fr', 'ja'];

function languageHint(env: NanoEnvironment): string {
  const language = env.languages[0] ?? 'en';
  if (NANO_OFFICIAL_LANGUAGES.includes(language)) return '';
  return ` Модель официально поддерживает ${NANO_OFFICIAL_LANGUAGES.join('/')}, поэтому на других языках ответы могут быть проще.`;
}

async function downloadModel(): Promise<void> {
  setup.setError(null);

  // Chrome уже сказал, что модель недоступна — запускать create() бессмысленно
  if (nanoEnv?.availability === 'unavailable') {
    patchModel({ hint: NANO_ENABLE_HINT, recheckVisible: true });
    setup.setError(
      'Chrome сообщает, что встроенная модель недоступна. Включите флаги Prompt API, скачайте модель в chrome://components и нажмите «Проверить снова».',
    );
    return;
  }

  setup.setBusy('download', true);
  patchModel({
    badge: 'загрузка…',
    tone: 'warn',
    note: 'Chrome скачивает Gemini Nano. Это может занять несколько минут — прогресс ниже.',
    downloadVisible: true,
    downloadLabel: 'Загрузка…',
    downloadDisabled: true,
    demoVisible: true,
    progress: 0,
    hint: null,
    recheckVisible: false,
  });

  const nano = new NanoBrain({
    languages: nanoEnv?.languages,
    onDownloadProgress: (progress) => patchModel({ progress }),
  });

  try {
    await nano.warmUp();
    brain = nano;
    applyEngine('nano', 'Gemini Nano', true);
    chat.setMode('Gemini Nano · на связи');
    chat.setEnabled(true);
    patchModel({
      badge: 'готова',
      tone: 'good',
      note: 'Модель установлена. Проводник ожил — можно входить в мир.',
      downloadVisible: false,
      downloadDisabled: false,
      downloadLabel: 'Скачать модель Gemini Nano',
      demoVisible: false,
      progress: null,
      hint: null,
      recheckVisible: false,
    });
    hud.toast('Gemini Nano готова к работе');
  } catch (error) {
    console.error('[visual-lab] не удалось запустить Gemini Nano', error);
    setup.setError(
      `Не удалось запустить модель: ${describeError(error)}. Проверьте флаги chrome://flags/#prompt-api-for-gemini-nano и #optimization-guide-on-device-model, затем скачайте модель в chrome://components («Optimization Guide On Device Model» → Check for update) и нажмите «Проверить снова».`,
    );
    patchModel({
      badge: 'ошибка загрузки',
      tone: 'bad',
      note: 'Попробуйте ещё раз или продолжайте в демо-режиме — он работает без ИИ.',
      downloadVisible: true,
      downloadLabel: 'Попробовать снова',
      downloadDisabled: false,
      demoVisible: true,
      progress: null,
      hint: NANO_ENABLE_HINT,
      recheckVisible: true,
    });
  } finally {
    setup.setBusy('download', false);
  }
}

function activateDemo(note?: string): void {
  if (brain) brain.dispose();
  brain = new DemoBrain();
  applyEngine('demo', 'Демо-режим', Boolean(note));
  chat.setMode('демо-режим без ИИ');
  chat.setEnabled(true);
  patchModel({ demoVisible: false, progress: null });
  if (note) {
    chat.addMessage({ role: 'conductor', text: note, kind: 'system' });
  }
}

/* ----------------------------------------------------------------- база --- */

async function initStorage(): Promise<void> {
  if (!supportsFileSystemAccess()) {
    patchDb({
      badge: 'IndexedDB',
      tone: 'warn',
      note: 'Этот браузер не умеет выбирать файл на диске (нужен Chrome или Edge). База будет жить в IndexedDB браузера.',
      createLabel: 'Создать базу в браузере',
      openLabel: 'Открыть файл',
      openDisabled: true,
      resumeLabel: null,
      idbLabel: null,
    });
    return;
  }

  rememberedHandle = await loadRememberedHandle();
  if (!rememberedHandle) {
    patchDb({ resumeLabel: null });
    return;
  }

  const granted = await hasPermission(rememberedHandle);
  patchDb({
    badge: rememberedHandle.name,
    tone: granted ? 'good' : 'warn',
    note: granted
      ? 'Найден прошлый файл базы — нажмите «Продолжить», чтобы открыть его.'
      : 'Прошлый файл базы на месте, но Chrome попросит подтвердить доступ к нему.',
    resumeLabel: `Продолжить с ${rememberedHandle.name}`,
  });
}

async function createDatabase(): Promise<void> {
  setup.setError(null);
  setup.setBusy('db', true);
  try {
    if (supportsFileSystemAccess()) {
      const handle = await pickNewDatabaseFile();
      if (!handle) return;
      await openDatabase(new FileStorage(handle), 'Новая база создана');
    } else {
      await openDatabase(new IdbStorage(), 'База создана в браузере');
    }
  } catch (error) {
    setup.setError(`Не удалось создать базу: ${describeError(error)}`);
  } finally {
    setup.setBusy('db', false);
  }
}

async function openExistingDatabase(): Promise<void> {
  setup.setError(null);
  setup.setBusy('db', true);
  try {
    const handle = await pickExistingDatabaseFile();
    if (!handle) return;
    await openDatabase(new FileStorage(handle), 'База открыта');
  } catch (error) {
    setup.setError(`Не удалось открыть базу: ${describeError(error)}`);
  } finally {
    setup.setBusy('db', false);
  }
}

async function createIdbDatabase(): Promise<void> {
  setup.setError(null);
  setup.setBusy('db', true);
  try {
    await openDatabase(new IdbStorage(), 'База создана в браузере');
  } catch (error) {
    setup.setError(`Не удалось создать базу: ${describeError(error)}`);
  } finally {
    setup.setBusy('db', false);
  }
}

async function resumeDatabase(): Promise<void> {
  if (!rememberedHandle) return;
  setup.setError(null);
  setup.setBusy('db', true);
  try {
    const granted = await requestPermission(rememberedHandle);
    if (!granted) {
      setup.setError('Доступ к файлу не подтверждён. Выберите файл вручную.');
      return;
    }
    await openDatabase(new FileStorage(rememberedHandle), 'База открыта');
  } catch (error) {
    setup.setError(`Не удалось открыть базу: ${describeError(error)}`);
  } finally {
    setup.setBusy('db', false);
  }
}

async function openDatabase(storage: DbStorage, label: string): Promise<void> {
  world.clearVisualizations();
  const result = await db.open(storage);
  dbReady = true;

  const items = db.list();
  world.syncGallery(items);

  hud.setDbStatus(`${storage.label} · ${items.length}`, 'good');
  patchDb({
    badge: storage.label,
    tone: 'good',
    note: `${label}. Записей в базе: ${items.length} ${plural(items.length, 'модель', 'модели', 'моделей')}. Изменения сохраняются в файл автоматически.`,
    createLabel: 'Сменить базу',
    openLabel: 'Открыть другую',
    openDisabled: false,
  });
  setup.setCanEnter(true);
  setup.setError(null);
  const createdLabel = storage.kind === 'idb' ? 'Создана база в браузере' : `Создан файл ${storage.label}`;
  hud.toast(result.created ? createdLabel : `Загружено ${items.length} визуализаций`);

  // смена базы через HUD: возвращаемся в мир, не заставляя жать «Войти»
  if (entered) {
    setup.hide();
    world.setInteractive(true);
  }
}

/* --------------------------------------------------- локальная модель ---- */

const LOCAL_MODEL_HINT = `
  <ol>
    <li>Модель скачивается один раз (GGUF с HuggingFace) и сохраняется в Cache Storage браузера.</li>
    <li>После этого Visual Lab работает офлайн: сервер и API не нужны.</li>
    <li>Считает на CPU через WebAssembly — на слабых машинах ответ может занять 20–60 секунд.</li>
    <li>Кнопка «Удалить из кэша» освобождает место (несколько сотен мегабайт).</li>
  </ol>
`;

/** Движок wllama (~380 КБ JS) грузим только тем, кто включает локальную модель. */
async function createLocalBrain(
  options: { onDownloadProgress?: (progress: number) => void } = {},
): Promise<import('./ai/wllama-brain').WllamaBrain> {
  const { WllamaBrain } = await import('./ai/wllama-brain');
  return new WllamaBrain({ modelUrl: localModelUrl(localModel), ...options });
}

async function initLocalModel(): Promise<void> {
  const url = localModelUrl(localModel);
  const flag = readLocalModelFlag();
  let cached = false;
  let bytes = flag?.url === url ? flag.bytes : 0;

  // движок поднимаем только если модель действительно когда-то скачивали
  if (flag?.url === url) {
    const info = await inspectLocalModel(url);
    cached = info.cached;
    bytes = info.bytes;
    if (!cached) clearLocalModelFlag();
  }

  const estimate = await storageEstimate();
  const info = { cached, bytes };
  const size = info.cached && info.bytes > 0 ? formatBytes(info.bytes) : `${localModel.sizeMb} МБ`;
  const usage = estimate ? ` Занято на сайте: ${formatBytes(estimate.usage)}.` : '';

  const localActive = brain?.kind === 'local';
  patchLocal({
    badge: localActive ? 'работает сейчас' : info.cached ? 'в кэше' : 'не скачана',
    tone: localActive || info.cached ? 'good' : 'neutral',
    note: info.cached
      ? `Локальная модель ${localModel.label} уже скачана (${size}) — проводник может работать без Gemini Nano и офлайн.${usage}`
      : `Если Gemini Nano недоступна, скачайте локальную модель: ${localModel.label}, ${localModel.sizeMb} МБ, лицензия ${localModel.license}. Работает на WebAssembly прямо в браузере.`,
    downloadVisible: !info.cached,
    downloadLabel: `Скачать модель (${localModel.sizeMb} МБ)`,
    downloadDisabled: false,
    useVisible: info.cached && brain?.kind !== 'local',
    useLabel: 'Подключить локальную модель',
    deleteVisible: info.cached,
    progress: null,
    hint: LOCAL_MODEL_HINT,
  });

  // модель уже в кэше, а Gemini Nano нет — подключаем автоматически
  if (info.cached && !brain) {
    try {
      await attachLocalBrain(true);
    } catch (error) {
      console.warn('[visual-lab] не удалось подключить локальную модель', error);
      clearLocalModelFlag();
      patchLocal({
        badge: 'не скачана',
        tone: 'neutral',
        downloadVisible: true,
        useVisible: false,
        deleteVisible: false,
      });
    }
  }
}

async function attachLocalBrain(silent = false): Promise<void> {
  const previous = brain;
  const local = await createLocalBrain();
  brain = local;
  if (previous && previous !== local) previous.dispose();

  chat.setEnabled(true);
  chat.setMode(`${localModel.label} · локально`);
  applyEngine('local', `${localModel.label} (WASM)`, !silent);
  patchLocal({ useVisible: false });

  if (!silent) {
    hud.toast('Локальная модель подключена');
    world.setConductorStatus('speaking');
    chat.addMessage({
      role: 'conductor',
      kind: 'system',
      text: 'Теперь я работаю на локальной модели в браузере. Первый ответ будет дольше — модель загружается в память.',
    });
  }
}

async function downloadLocalModel(): Promise<void> {
  setup.setError(null);
  setup.setBusy('local', true);
  patchLocal({
    badge: 'загрузка…',
    tone: 'warn',
    note: `Скачиваю ${localModel.label} (${localModel.sizeMb} МБ). Не закрывайте вкладку — прогресс сохраняется в кэше браузера.`,
    downloadVisible: true,
    downloadLabel: 'Загрузка…',
    downloadDisabled: true,
    useVisible: false,
    deleteVisible: false,
    progress: 0,
  });

  const local = await createLocalBrain({
    onDownloadProgress: (progress) => patchLocal({ progress }),
  });

  try {
    await local.warmUp();
    writeLocalModelFlag(localModelUrl(localModel), 0);
    brain = local;
    chat.setEnabled(true);
    chat.setMode(`${localModel.label} · локально`);
    applyEngine('local', `${localModel.label} (WASM)`);
    hud.toast('Локальная модель готова и сохранена в кэше');
    world.setConductorStatus('speaking');
    await initLocalModel();
    patchLocal({ progress: null });
    setup.setError(null);
  } catch (error) {
    console.error('[visual-lab] не удалось загрузить локальную модель', error);
    const reason = /network|fetch|abort|timeout|ECONN/i.test(String(describeError(error)))
      ? 'соединение прервано или сеть недоступна — проверьте интернет и попробуйте снова'
      : describeError(error);
    setup.setError(`Не удалось скачать локальную модель: ${reason}`);
    patchLocal({
      badge: 'ошибка',
      tone: 'bad',
      note: 'Проверьте соединение и свободное место на диске, затем попробуйте ещё раз.',
      downloadVisible: true,
      downloadLabel: `Попробовать снова (${localModel.sizeMb} МБ)`,
      downloadDisabled: false,
      useVisible: false,
      deleteVisible: false,
      progress: null,
    });
  } finally {
    setup.setBusy('local', false);
  }
}

async function deleteLocalModel(): Promise<void> {
  if (!window.confirm(`Удалить локальную модель из кэша (${localModel.sizeMb} МБ)?`)) return;
  setup.setBusy('local', true);
  try {
    if (brain?.kind === 'local') {
      brain.dispose();
      brain = null;
      chat.setEnabled(false);
      chat.setMode('Gemini Nano недоступна');
      applyEngine('demo', 'Демо-режим');
    }
    await removeLocalModel(localModelUrl(localModel));
    hud.toast('Локальная модель удалена из кэша');
    await initLocalModel();
    if (!brain) activateDemo('Локальная модель удалена — работаю в демо-режиме.');
  } catch (error) {
    setup.setError(`Не удалось удалить модель: ${describeError(error)}`);
  } finally {
    setup.setBusy('local', false);
  }
}

/* ------------------------------------------------------------------ мир --- */

function enterWorld(): void {
  if (!dbReady) {
    setup.setError('Сначала выберите базу данных — в неё будут сохраняться модели.');
    return;
  }

  if (!brain) {
    activateDemo(
      'Gemini Nano пока не установлена, поэтому я работаю в демо-режиме. Визуализации из шаблонов сохраняются в базу точно так же.',
    );
  }

  entered = true;
  setup.hide();
  setup.setError(null);
  world.setInteractive(true);
  world.lock();

  hud.setVisible(true);
  hud.setHint('WASD — движение · Shift — бег · T — чат · G — галерея · Esc — освободить курсор');

  const count = db.count();
  if (!greeted) {
    greeted = true;
    const hello =
      brain?.kind === 'nano'
        ? 'Я рядом и на связи. Скажите, что показать — соберу это из 3D-примитивов и сохраню в вашу базу.'
        : brain?.kind === 'local'
          ? 'Я работаю на локальной модели в браузере. Скажите, что показать — первые ответы будут медленнее, модель загружается в память.'
          : 'Я рядом. Работаю в демо-режиме — попросите показать дом, ёлку, солнечную систему или график.';
    chat.addMessage({
      role: 'conductor',
      text:
        count > 0
          ? `${hello} В базе уже ${count} ${plural(count, 'модель', 'модели', 'моделей')} — они расставлены по кругу площадки.`
          : hello,
    });
  }
  world.setConductorStatus('speaking');
}

function showHelp(): void {
  chat.addMessage({
    role: 'conductor',
    kind: 'system',
    text:
      'Управление: WASD или стрелки — идти, Shift — бежать, мышь — смотреть, T — чат, G — галерея, H — эта справка, Esc — освободить курсор. Модели можно смотреть в галерее и возвращать в мир кнопкой «Показать».',
  });
}

async function handleSubmit(text: string): Promise<void> {
  if (!brain || busy) return;
  busy = true;

  chat.addMessage({ role: 'user', text });
  db.addMessage('user', text);
  chat.setThinking(true, 'Проводник думает…');
  world.setConductorStatus('thinking');

  try {
    const reply = await brain.chat(text, {
      onStatus: (status: ConductorStatus) => {
        world.setConductorStatus(status);
        chat.setThinking(true, status === 'drawing' ? 'Проводник строит модель…' : 'Проводник думает…');
      },
      onNotice: (notice) => {
        if (notice) {
          chat.setThinking(true, notice);
        } else {
          chat.setThinking(true, 'Проводник думает…');
        }
      },
    });

    let chip: { id: string; title: string } | undefined;

    if (reply.visualization) {
      const viz: Visualization = {
        id: newId(),
        title: reply.visualization.title,
        description: reply.visualization.description,
        prompt: text,
        spec: reply.visualization,
        createdAt: Date.now(),
        source: brain.kind,
      };

      db.insert(viz);
      world.showVisualization(viz);
      world.syncGallery(db.list());
      hud.setDbStatus(`${db.locationLabel} · ${db.count()}`, 'good');
      hud.toast(`«${viz.title}» сохранена в базе`);
      await db.saveNow();
      chip = { id: viz.id, title: viz.title };
      world.setConductorStatus('speaking');
    }

    chat.addMessage({ role: 'conductor', text: reply.reply }, chip);
    db.addMessage('conductor', reply.reply);
  } catch (error) {
    const message =
      brain.kind === 'local'
        ? `Локальная модель не смогла ответить: ${describeError(error)}. Если ошибка повторяется — удалите модель в разделе «Локальная модель» и скачайте рекомендованную Qwen2.5-0.5B.`
        : `Не получилось: ${describeError(error)}`;
    chat.addMessage({ role: 'conductor', text: message, kind: 'error' });
    hud.toast(message, 'error');
  } finally {
    busy = false;
    chat.setThinking(false);
    window.setTimeout(() => world.setConductorStatus('idle'), 2400);
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `viz-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

/* -------------------------------------------------------------- галерея --- */

function toggleGallery(): void {
  if (gallery.isOpen) {
    gallery.close();
    return;
  }
  if (!dbReady) {
    hud.toast('Сначала выберите базу данных', 'error');
    openSetup();
    return;
  }
  world.unlock();
  gallery.open(db.list());
}

function showSavedVisualization(id: string): void {
  if (!dbReady) return;
  const item = db.list().find((viz) => viz.id === id);
  if (!item) {
    hud.toast('Эта модель не найдена в базе', 'error');
    return;
  }
  world.showVisualization(item);
  world.syncGallery(db.list());
  hud.toast(`Показана «${item.title}»`);
  world.setConductorStatus('speaking');
}

function deleteVisualization(id: string): void {
  const items = db.list();
  const item = items.find((viz) => viz.id === id);
  if (!item) return;
  if (!window.confirm(`Удалить «${item.title}» из базы?`)) return;

  db.remove(id);
  world.removeVisualization(id);
  world.syncGallery(db.list());
  gallery.open(db.list());
  hud.setDbStatus(`${db.locationLabel} · ${db.count()}`, 'good');
  hud.toast('Визуализация удалена');
}

function openSetup(): void {
  if (entered) world.unlock();
  world.setInteractive(false);
  setup.setCanEnter(dbReady);
  setup.show();
}

function bindShortcuts(): void {
  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    const typing = Boolean(target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

    if (event.key === 'Escape') {
      if (gallery.isOpen) {
        gallery.close();
        event.preventDefault();
      }
      return;
    }

    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

    const key = event.key.toLowerCase();
    if (key === 't') {
      event.preventDefault();
      world.unlock();
      chat.focus();
    }
    if (key === 'g') {
      event.preventDefault();
      toggleGallery();
    }
    if (key === 'h' || key === '?') {
      event.preventDefault();
      showHelp();
    }
  });
}

window.addEventListener('beforeunload', () => {
  void db.saveNow();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) void db.saveNow();
});

void boot().catch((error: unknown) => {
  console.error('[visual-lab] не удалось запустить приложение', error);
  const screen = document.getElementById('boot-screen');
  if (screen) {
    screen.innerHTML = `<p>Не удалось запустить Visual Lab: ${describeError(error)}</p>`;
  }
});
