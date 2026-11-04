/**
 * Тонкая обёртка над встроенной в Chrome моделью Gemini Nano (Prompt API).
 *
 * Поддерживаются оба варианта API:
 *  - новый: `LanguageModel.availability()` / `LanguageModel.create()` (Chrome 138+).
 *    Свежие сборки требуют языковую конфигурацию (`expectedInputs`/`expectedOutputs`
 *    с `languages`), иначе модель считается недоступной («no execution config»);
 *  - старый: `ai.languageModel.capabilities()` / `ai.languageModel.create()`.
 *
 * Загрузка модели (несколько ГБ) инициируется вызовом `create()` и требует
 * пользовательского жеста, поэтому UI всегда запускает её по нажатию кнопки.
 */

export type NanoAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

export interface NanoEnvironment {
  /** Есть ли в браузере хоть какой-то Prompt API. */
  supported: boolean;
  availability: NanoAvailability;
  /** legacy-вариант (`ai.languageModel`) не умеет JSON-схемы. */
  legacy: boolean;
  /** Человекочитаемое пояснение для UI. */
  note: string;
  /** Языки (BCP 47), с которыми модель доступна: их требует современный Prompt API. */
  languages: string[];
}

interface DownloadProgressEvent extends Event {
  loaded: number;
}

interface MonitorTarget {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: DownloadProgressEvent) => void,
    options?: AddEventListenerOptions,
  ): void;
}

interface LanguageModelSessionLike {
  prompt(
    input: string,
    options?: { responseConstraint?: unknown; signal?: AbortSignal },
  ): Promise<string>;
  destroy(): void;
  clone?: () => Promise<LanguageModelSessionLike>;
}

interface LanguageModelApiLike {
  availability?: (options?: unknown) => Promise<string>;
  capabilities?: () => Promise<{ available: string }>;
  create: (options?: Record<string, unknown>) => Promise<LanguageModelSessionLike>;
  params?: () => Promise<Record<string, unknown>>;
}

interface GlobalWithAI {
  LanguageModel?: LanguageModelApiLike;
  ai?: { languageModel?: LanguageModelApiLike };
}

function getApi(): { api: LanguageModelApiLike; legacy: boolean } | null {
  const g = globalThis as unknown as GlobalWithAI;
  if (g.LanguageModel && typeof g.LanguageModel.create === 'function') {
    return { api: g.LanguageModel, legacy: false };
  }
  if (g.ai?.languageModel && typeof g.ai.languageModel.create === 'function') {
    return { api: g.ai.languageModel, legacy: true };
  }
  return null;
}

function normalizeAvailability(raw: string): NanoAvailability {
  switch (raw) {
    case 'available':
    case 'readily':
      return 'available';
    case 'downloadable':
    case 'after-download':
    case 'downloadable-and-downloading':
      return 'downloadable';
    case 'downloading':
      return 'downloading';
    default:
      return 'unavailable';
  }
}

function availabilityNote(availability: NanoAvailability): string {
  switch (availability) {
    case 'available':
      return 'Gemini Nano готова к работе.';
    case 'downloading':
      return 'Модель уже скачивается браузером — осталось подождать.';
    case 'downloadable':
      return 'Модель ещё не установлена. Её нужно один раз скачать (~2–4 ГБ).';
    default:
      return 'Gemini Nano недоступна на этом устройстве или отключена в настройках Chrome.';
  }
}

export function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message) return message;
      try {
        return JSON.stringify(error);
      } catch {
        return String(error);
      }
    }
    return String(error);
  }
  if (/user gesture/i.test(error.message)) {
    return 'браузер требует явного клика по кнопке (жест пользователя)';
  }
  if (/show(Save|Open)FilePicker/.test(error.message)) {
    return 'браузер не смог открыть диалог выбора файла';
  }
  switch (error.name) {
    case 'NotAllowedError':
      return 'браузер требует явного действия пользователя (нажмите кнопку ещё раз)';
    case 'NotSupportedError':
      return 'Chrome не может запустить встроенную модель (обычно не включены флаги Prompt API или модель не скачана в chrome://components)';
    case 'QuotaExceededError':
      return 'не хватает места на диске для модели';
    case 'AbortError':
      return 'запрос отменён';
    case 'InvalidStateError':
      return 'сессия модели в недопустимом состоянии, попробуйте пересоздать её';
    default:
      return error.message || error.name;
  }
}

/**
 * Языки, которые поддерживают текущие сборки Gemini Nano в Chrome.
 * Chrome прерывает запрос, если указать хоть один неподдерживаемый тег, поэтому
 * мы пробуем только языки из этого списка (и никогда не передаём список целиком).
 */
const KNOWN_SUPPORTED_LANGUAGES = ['de', 'en', 'es', 'fr', 'ja'];

/** Базовые теги языков браузера: ['ru', 'en', ...]. */
function preferredLanguages(): string[] {
  const result: string[] = [];
  const push = (tag: string | undefined): void => {
    const base = tag?.split('-')[0]?.toLowerCase();
    if (!base || base.length !== 2 || result.includes(base)) return;
    result.push(base);
  };
  if (typeof navigator !== 'undefined') {
    for (const tag of navigator.languages ?? []) push(tag);
    push(navigator.language);
  }
  return result;
}

/** Язык браузера, если Chrome его поддерживает, иначе английский. */
function candidateLanguages(): string[] {
  const preferred = preferredLanguages()[0];
  const candidates: string[] = [];
  if (preferred && KNOWN_SUPPORTED_LANGUAGES.includes(preferred)) candidates.push(preferred);
  if (!candidates.includes('en')) candidates.push('en');
  return candidates;
}

type AvailabilityOptions = {
  expectedInputs: Array<{ type: 'text'; languages: string[] }>;
  expectedOutputs: Array<{ type: 'text'; languages: string[] }>;
};

function availabilityOptions(languages: string[]): AvailabilityOptions | undefined {
  if (languages.length === 0) return undefined;
  return {
    expectedInputs: [{ type: 'text', languages }],
    expectedOutputs: [{ type: 'text', languages }],
  };
}

async function readAvailability(
  api: LanguageModelApiLike,
  legacy: boolean,
  languages: string[],
): Promise<string> {
  if (legacy || !api.availability) {
    return (await api.capabilities?.())?.available ?? 'no';
  }
  return api.availability(availabilityOptions(languages));
}

/**
 * Определяет, есть ли Prompt API и в каком состоянии модель.
 *
 * Современный Chrome требует языковую конфигурацию (`expectedInputs` /
 * `expectedOutputs` с `languages`), иначе модель считается недоступной
 * («no execution config»). Пробуем языки по одному, от языка браузера к
 * английскому; старые сборки просто игнорируют эти опции.
 */
export async function detectNano(): Promise<NanoEnvironment> {
  const found = getApi();
  if (!found) {
    return {
      supported: false,
      availability: 'unavailable',
      legacy: false,
      note: 'Браузер не поддерживает Prompt API. Нужен Chrome 138+ (desktop) со встроенным Gemini Nano.',
      languages: ['en'],
    };
  }

  const attempts: string[][] = found.legacy
    ? [[]]
    : candidateLanguages().map((language) => [language]);

  let lastError: unknown = null;
  for (const languages of attempts) {
    try {
      const raw = await readAvailability(found.api, found.legacy, languages);
      const availability = normalizeAvailability(raw);
      if (availability !== 'unavailable') {
        return {
          supported: true,
          availability,
          legacy: found.legacy,
          note: availabilityNote(availability),
          languages: languages.length ? languages : ['en'],
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  return {
    supported: true,
    availability: 'unavailable',
    legacy: found.legacy,
    note: lastError
      ? `Не удалось узнать состояние модели: ${describeError(lastError)}`
      : availabilityNote('unavailable'),
    languages: candidateLanguages().slice(-1),
  };
}

export interface NanoSessionOptions {
  systemPrompt: string;
  /** Языки для expectedInputs/expectedOutputs (BCP 47). */
  languages?: string[];
  temperature?: number;
  /** 0..1 — прогресс скачивания модели. */
  onDownloadProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export class NanoSession {
  private session: LanguageModelSessionLike;
  readonly legacy: boolean;

  private constructor(session: LanguageModelSessionLike, legacy: boolean) {
    this.session = session;
    this.legacy = legacy;
  }

  /**
   * Создаёт сессию. Если модель ещё не скачана — Chrome начнёт загрузку,
   * а прогресс придёт в `onDownloadProgress`.
   */
  static async create(options: NanoSessionOptions): Promise<NanoSession> {
    const found = getApi();
    if (!found) throw new Error('Prompt API недоступен в этом браузере');

    const base: Record<string, unknown> = {
      monitor(monitor: MonitorTarget) {
        monitor.addEventListener('downloadprogress', (event) => {
          options.onDownloadProgress?.(Math.max(0, Math.min(1, event.loaded)));
        });
      },
    };

    if (typeof options.temperature === 'number') base.temperature = options.temperature;

    const languages = options.languages ?? [];

    const attempt = async (
      withSystemPrompt: boolean,
      withLanguages: boolean,
    ): Promise<LanguageModelSessionLike> => {
      const payload: Record<string, unknown> = { ...base };
      if (withSystemPrompt) {
        payload.initialPrompts = [{ role: 'system', content: options.systemPrompt }];
        // старый API принимает системный промпт отдельным полем
        if (found.legacy) payload.systemPrompt = options.systemPrompt;
      }
      // современные сборки требуют явную языковую конфигурацию
      if (withLanguages && !found.legacy && languages.length > 0) {
        Object.assign(payload, availabilityOptions(languages));
      }
      if (options.signal) payload.signal = options.signal;
      return found.api.create(payload);
    };

    // Варианты опций для разных сборок Chrome. Повторяем только если ошибка
    // похожа на «непонятный набор опций»: NotSupportedError/NotAllowedError
    // означают, что модель вообще не может обслужить запрос.
    const variants: Array<[boolean, boolean]> = [
      [true, true],
      [true, false],
    ];

    let lastError: unknown = null;
    for (const [withSystemPrompt, withLanguages] of variants) {
      try {
        return new NanoSession(await attempt(withSystemPrompt, withLanguages), found.legacy);
      } catch (error) {
        lastError = error;
        if (!(error instanceof Error)) break;
        const retryableOptions = /TypeError|InvalidStateError|NotReadableError/.test(error.name);
        if (!retryableOptions) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('не удалось создать сессию модели');
  }

  /** Запрос к модели. `schema` — JSON Schema для структурного ответа. */
  async prompt(input: string, schema?: object): Promise<string> {
    if (schema && !this.legacy) {
      return this.session.prompt(input, { responseConstraint: schema });
    }
    return this.session.prompt(input);
  }

  destroy(): void {
    try {
      this.session.destroy();
    } catch {
      /* сессия могла уже быть уничтожена */
    }
  }
}
