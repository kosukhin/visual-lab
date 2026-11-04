import type { BrainHooks, BrainReply, ConductorBrain } from '../types';
import { NanoSession, describeError } from './gemini-nano';
import {
  CONDUCTOR_SYSTEM_PROMPT,
  PLAN_SCHEMA,
  VIZ_SCHEMA,
  buildPlanPrompt,
  buildSpecPrompt,
  extractJson,
  normalizeSpec,
} from './prompts';

/** После стольких реплик пересоздаём сессию, чтобы не переполнить контекст. */
const MAX_TURNS_BEFORE_RESET = 10;
/** Сколько последних реплик переносим в новую сессию. */
const HISTORY_WINDOW = 6;

interface PlanResult {
  reply: string;
  action: 'none' | 'visualize';
  request: string;
}

function parsePlan(raw: string, fallbackRequest: string): PlanResult {
  try {
    const data = extractJson(raw) as Record<string, unknown>;
    const reply = typeof data.reply === 'string' ? data.reply.trim() : '';
    const action = data.action === 'visualize' ? 'visualize' : 'none';
    const request =
      typeof data.request === 'string' && data.request.trim()
        ? data.request.trim()
        : fallbackRequest;
    return { reply: reply || 'Хорошо.', action, request };
  } catch {
    // без JSON: считаем, что модель просто ответила текстом
    return { reply: raw.trim().slice(0, 500) || 'Хорошо.', action: 'none', request: fallbackRequest };
  }
}

/**
 * Проводник на встроенной модели Chrome.
 *
 * Работает в два шага: сначала короткий «план» (ответ + нужно ли что-то
 * рисовать), затем — при необходимости — генерация JSON-спеки модели.
 * Схемы ответа задаются через `responseConstraint`, поэтому парсинг надёжен.
 */
export class NanoBrain implements ConductorBrain {
  readonly kind = 'nano' as const;
  readonly label = 'Gemini Nano';

  private session: NanoSession | null = null;
  private turns = 0;
  private disposed = false;
  private history: string[] = [];

  constructor(
    private readonly options: {
      languages?: string[];
      onDownloadProgress?: (progress: number) => void;
    } = {},
  ) {}

  private async ensureSession(): Promise<NanoSession> {
    if (this.disposed) throw new Error('Проводник остановлен');
    if (!this.session) {
      const systemPrompt = this.history.length
        ? `${CONDUCTOR_SYSTEM_PROMPT}\n\nНедавний диалог:\n${this.history.join('\n')}`
        : CONDUCTOR_SYSTEM_PROMPT;
      this.session = await NanoSession.create({
        systemPrompt,
        languages: this.options.languages,
        temperature: 0.6,
        onDownloadProgress: this.options.onDownloadProgress,
      });
      this.turns = 0;
    }
    return this.session;
  }

  /** Загружает модель (если нужно) и создаёт сессию заранее. */
  async warmUp(): Promise<void> {
    await this.ensureSession();
  }

  private isRecoverable(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return (
      error.name === 'InvalidStateError' ||
      /session|InvalidState|unknown/i.test(`${error.name} ${error.message}`)
    );
  }

  private resetSession(): void {
    this.session?.destroy();
    this.session = null;
    this.turns = 0;
  }

  private remember(userText: string, reply: string): void {
    this.history.push(`Пользователь: ${userText}`, `Проводник: ${reply}`);
    if (this.history.length > HISTORY_WINDOW) {
      this.history = this.history.slice(-HISTORY_WINDOW);
    }
  }

  async chat(userText: string, hooks?: BrainHooks): Promise<BrainReply> {
    const text = userText.trim();
    if (!text) return { reply: 'Я слушаю.', visualization: null };

    hooks?.onStatus?.('thinking');
    const plan = await this.runPlan(text);

    let visualization: BrainReply['visualization'] = null;
    if (plan.action === 'visualize') {
      hooks?.onStatus?.('drawing');
      try {
        visualization = await this.runSpec(plan.request || text);
      } catch (error) {
        return {
          reply: `${plan.reply} Не получилось построить модель: ${describeError(error)}.`,
          visualization: null,
        };
      }
    }

    this.remember(text, plan.reply);
    return { reply: plan.reply, visualization };
  }

  private async runPlan(text: string): Promise<PlanResult> {
    if (this.turns >= MAX_TURNS_BEFORE_RESET) this.resetSession();
    try {
      const session = await this.ensureSession();
      this.turns += 1;
      const raw = await session.prompt(buildPlanPrompt(text), PLAN_SCHEMA);
      return parsePlan(raw, text);
    } catch (error) {
      if (!this.isRecoverable(error)) throw error;
      this.resetSession();
      const session = await this.ensureSession();
      this.turns += 1;
      const raw = await session.prompt(buildPlanPrompt(text), PLAN_SCHEMA);
      return parsePlan(raw, text);
    }
  }

  private async runSpec(request: string): Promise<BrainReply['visualization']> {
    const prompt = buildSpecPrompt(request);
    const run = async (): Promise<unknown> => {
      const session = await this.ensureSession();
      this.turns += 1;
      return extractJson(await session.prompt(prompt, VIZ_SCHEMA));
    };

    try {
      return normalizeSpec(await run());
    } catch (error) {
      if (!this.isRecoverable(error)) throw error;
      this.resetSession();
      return normalizeSpec(await run());
    }
  }

  reset(): void {
    this.resetSession();
    this.history = [];
  }

  dispose(): void {
    this.disposed = true;
    this.resetSession();
    this.history = [];
  }
}
