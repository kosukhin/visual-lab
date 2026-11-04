/**
 * Тонкая обёртка над встроенной в Chrome моделью Gemini Nano (Prompt API).
 *
 * Поддерживаются оба варианта API:
 *  - новый: `LanguageModel.availability()` / `LanguageModel.create()` (Chrome 138+);
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
  if (!(error instanceof Error)) return String(error);
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
      return 'модель не поддерживает этот запрос (язык или формат ответа)';
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

/** Определяет, есть ли Prompt API и в каком состоянии модель. */
export async function detectNano(): Promise<NanoEnvironment> {
  const found = getApi();
  if (!found) {
    return {
      supported: false,
      availability: 'unavailable',
      legacy: false,
      note: 'Браузер не поддерживает Prompt API. Нужен Chrome 138+ (desktop) со встроенным Gemini Nano.',
    };
  }

  try {
    const raw = found.api.availability
      ? await found.api.availability()
      : ((await found.api.capabilities?.())?.available ?? 'no');
    const availability = normalizeAvailability(raw);
    return {
      supported: true,
      availability,
      legacy: found.legacy,
      note: availabilityNote(availability),
    };
  } catch (error) {
    return {
      supported: true,
      availability: 'unavailable',
      legacy: found.legacy,
      note: `Не удалось узнать состояние модели: ${describeError(error)}`,
    };
  }
}

export interface NanoSessionOptions {
  systemPrompt: string;
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

    const attempt = async (withSystemPrompt: boolean): Promise<LanguageModelSessionLike> => {
      const payload: Record<string, unknown> = { ...base };
      if (withSystemPrompt) {
        payload.initialPrompts = [{ role: 'system', content: options.systemPrompt }];
        // старый API принимает системный промпт отдельным полем
        if (found.legacy) payload.systemPrompt = options.systemPrompt;
      }
      if (options.signal) payload.signal = options.signal;
      return found.api.create(payload);
    };

    try {
      return new NanoSession(await attempt(true), found.legacy);
    } catch (error) {
      // некоторые сборки не принимают initialPrompts/signal — пробуем минимальный набор
      if (
        error instanceof Error &&
        /NotSupportedError|TypeError|InvalidStateError|NotReadableError/.test(error.name)
      ) {
        return new NanoSession(await attempt(false), found.legacy);
      }
      throw error;
    }
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
