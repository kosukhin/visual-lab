import './style.css';
import { DemoBrain } from './ai/demo-brain';
import { describeError, detectNano } from './ai/gemini-nano';
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
import type { ConductorBrain, ConductorStatus, Visualization } from './types';
import { ChatPanel } from './ui/chat';
import { GalleryPanel, plural } from './ui/gallery';
import { Hud } from './ui/hud';
import { SetupDialog, type DbState, type ModelState } from './ui/setup-dialog';
import { World } from './world/world';

/**
 * Точка сборки приложения:
 * мир ↔ проводник (Gemini Nano) ↔ база SQLite ↔ интерфейс.
 */

const db = new VizDatabase();

let world: World;
let hud: Hud;
let chat: ChatPanel;
let setup: SetupDialog;
let gallery: GalleryPanel;

let brain: ConductorBrain | null = null;
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
};

const dbState: DbState = {
  badge: 'файл не выбран',
  tone: 'neutral',
  note: 'Выберите файл на компьютере: в него будут записываться все визуализации.',
  createLabel: 'Создать новую базу',
  openLabel: 'Открыть существующую',
  resumeLabel: null,
  idbLabel: 'Хранить в браузере',
};

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Не найден элемент #${id}`);
  return element as T;
}

function patchModel(patch: Partial<ModelState>): void {
  Object.assign(modelState, patch);
  setup.setModelState(modelState);
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
    onCreateDatabase: () => void createDatabase(),
    onOpenDatabase: () => void openExistingDatabase(),
    onResumeDatabase: () => void resumeDatabase(),
    onCreateIdbDatabase: () => void createIdbDatabase(),
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

  setup.show();
  hideBootScreen();
}

function hideBootScreen(): void {
  const boot = document.getElementById('boot-screen');
  if (!boot) return;
  boot.classList.add('is-hidden');
  window.setTimeout(() => boot.remove(), 600);
}

async function initModel(): Promise<void> {
  const env = await detectNano();

  if (env.availability === 'available') {
    brain = new NanoBrain();
    hud.setBrainStatus('Gemini Nano', 'good');
    chat.setMode('Gemini Nano · на связи');
    chat.setEnabled(true);
    patchModel({
      badge: 'готова',
      tone: 'good',
      note: 'Gemini Nano уже установлена — проводник полностью работает.',
      downloadVisible: false,
      demoVisible: true,
      demoLabel: 'Демо-режим без ИИ',
      progress: null,
    });
    return;
  }

  hud.setBrainStatus(env.supported ? 'не установлена' : 'недоступна', 'warn');

  if (!env.supported) {
    patchModel({
      badge: 'недоступна',
      tone: 'bad',
      note: `${env.note} Проводник переключится в демо-режим: шаблонные визуализации, но всё остальное работает как обычно.`,
      downloadVisible: false,
      demoVisible: false,
      progress: null,
    });
    activateDemo();
    return;
  }

  const downloading = env.availability === 'downloading';
  patchModel({
    badge: downloading ? 'скачивается' : 'не установлена',
    tone: downloading ? 'warn' : 'neutral',
    note: `${env.note} Модель скачивается один раз, дальше работает офлайн.`,
    downloadVisible: true,
    downloadLabel: downloading ? 'Продолжить загрузку' : 'Скачать модель Gemini Nano',
    demoVisible: true,
    progress: null,
  });
}

/* --------------------------------------------------------------- модель --- */

async function downloadModel(): Promise<void> {
  setup.setError(null);
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
  });

  const nano = new NanoBrain({
    onDownloadProgress: (progress) => patchModel({ progress }),
  });

  try {
    await nano.warmUp();
    brain = nano;
    hud.setBrainStatus('Gemini Nano · готов', 'good');
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
    });
    hud.toast('Gemini Nano готова к работе');
  } catch (error) {
    setup.setError(`Не удалось запустить модель: ${describeError(error)}`);
    patchModel({
      badge: 'ошибка загрузки',
      tone: 'bad',
      note: 'Попробуйте ещё раз или продолжайте в демо-режиме — он работает без ИИ.',
      downloadVisible: true,
      downloadLabel: 'Попробовать снова',
      downloadDisabled: false,
      demoVisible: true,
      progress: null,
    });
  } finally {
    setup.setBusy('download', false);
  }
}

function activateDemo(note?: string): void {
  if (brain) brain.dispose();
  brain = new DemoBrain();
  hud.setBrainStatus('демо-режим', 'warn');
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
    const message = `Не получилось: ${describeError(error)}`;
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
