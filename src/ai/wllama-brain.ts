import type { Wllama } from '@wllama/wllama/esm/index.js';
import wllamaWasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import type { BrainHooks, BrainReply, ConductorBrain, VisualizationSpec } from '../types';
import { localModelUrl } from './local-model';
import {
  buildLocalPlanPrompt,
  buildLocalSpecPrompt,
  extractJson,
  normalizeSpec,
} from './prompts';

/**
 * Проводник на локальной модели (llama.cpp → WebAssembly, библиотека wllama).
 *
 * Модель скачивается один раз (GGUF с HuggingFace) и живёт в Cache Storage,
 * поэтому после первой загрузки проводник работает офлайн и без Gemini Nano.
 *
 * Gemini Nano умеет структурный вывод через `responseConstraint`; здесь вместо
 * этого — строгий промпт «только JSON» + восстановление ответа: `extractJson`
 * вытаскивает объект из текста, `normalizeSpec` приводит его к безопасному виду.
 */

const LOCAL_SYSTEM_PROMPT = `Ты — Проводник, ИИ-аватар в 3D-лаборатории Visual Lab. Ты всегда рядом с пользователем.
Отвечай кратко, на языке пользователя. Когда тебя просят вернуть JSON — возвращай только JSON-объект, без markdown, без пояснений и без текста вокруг.`;

const MAX_TOKENS_PLAN = 160;
const MAX_TOKENS_SPEC = 480;
const REQUEST_TIMEOUT_MS = 600_000;

export interface WllamaBrainOptions {
  modelUrl?: string;
  /** 0..1 — прогресс скачивания GGUF. */
  onDownloadProgress?: (progress: number) => void;
}

interface PlanResult {
  reply: string;
  action: 'none' | 'visualize';
  request: string;
}

function parsePlan(raw: string, fallbackRequest: string): PlanResult {
  try {
    const data = extractJson(raw) as Record<string, unknown>;
    return {
      reply: typeof data.reply === 'string' && data.reply.trim() ? data.reply.trim() : 'Хорошо.',
      action: data.action === 'visualize' ? 'visualize' : 'none',
      request:
        typeof data.request === 'string' && data.request.trim()
          ? data.request.trim()
          : fallbackRequest,
    };
  } catch {
    // слабая модель не выдала JSON — показываем её текст как обычный ответ
    const text = raw.trim();
    return {
      reply: text ? text.slice(0, 400) : 'Не получилось сформулировать ответ.',
      action: 'none',
      request: fallbackRequest,
    };
  }
}

export class WllamaBrain implements ConductorBrain {
  readonly kind = 'local' as const;
  readonly label = 'Локальная модель (WASM)';

  private engine: Wllama | null = null;
  private loading: Promise<Wllama> | null = null;
  private disposed = false;

  constructor(private readonly options: WllamaBrainOptions = {}) {}

  get isReady(): boolean {
    return this.engine !== null;
  }

  /** Скачивает (если нужно) и загружает модель в память. */
  async warmUp(): Promise<void> {
    await this.ensureEngine();
  }

  private async ensureEngine(): Promise<Wllama> {
    if (this.disposed) throw new Error('локальная модель остановлена');
    if (this.engine) return this.engine;
    if (!this.loading) {
      this.loading = this.createEngine().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }

  private async createEngine(): Promise<Wllama> {
    const { Wllama: WllamaCtor } = await import('@wllama/wllama/esm/index.js');
    const engine = new WllamaCtor(
      { default: wllamaWasmUrl },
      { allowOffline: true, suppressNativeLog: true, parallelDownloads: 3 },
    );

    await engine.loadModelFromUrl(this.options.modelUrl ?? localModelUrl(), {
      n_ctx: 2048,
      n_batch: 256,
      // CPU/WASM-путь: предсказуемо работает без WebGPU
      n_gpu_layers: 0,
      useCache: true,
      progressCallback: ({ loaded, total }) => {
        if (total > 0) this.options.onDownloadProgress?.(Math.min(1, loaded / total));
      },
    });

    if (this.disposed) {
      await engine.exit().catch(() => undefined);
      throw new Error('локальная модель остановлена');
    }

    this.engine = engine;
    return engine;
  }

  async chat(userText: string, hooks?: BrainHooks): Promise<BrainReply> {
    const text = userText.trim();
    if (!text) return { reply: 'Я слушаю.', visualization: null };

    if (!this.engine) {
      hooks?.onNotice?.('Загружаю локальную модель в память…');
    }
    hooks?.onStatus?.('thinking');
    const engine = await this.ensureEngine();
    hooks?.onNotice?.('');

    const plan = await this.askPlan(engine, text);

    let visualization: VisualizationSpec | null = null;
    if (plan.action === 'visualize') {
      hooks?.onStatus?.('drawing');
      try {
        visualization = await this.askSpec(engine, plan.request || text);
      } catch (error) {
        console.warn('[visual-lab] локальная модель не собрала визуализацию', error);
      }
    }

    return { reply: plan.reply, visualization };
  }

  private async askPlan(engine: Wllama, text: string): Promise<PlanResult> {
    const raw = await this.ask(engine, buildLocalPlanPrompt(text), MAX_TOKENS_PLAN);
    return parsePlan(raw, text);
  }

  private async askSpec(engine: Wllama, request: string): Promise<VisualizationSpec> {
    const raw = await this.ask(engine, buildLocalSpecPrompt(request), MAX_TOKENS_SPEC);
    try {
      return normalizeSpec(extractJson(raw));
    } catch {
      // одна попытка «починки»: просим строго JSON ещё раз
      const repair = await this.ask(
        engine,
        `Ответ не является валидным JSON. Задание: ${request}. Верни ТОЛЬКО JSON по схеме, без markdown.`,
        MAX_TOKENS_SPEC,
      );
      return normalizeSpec(extractJson(repair));
    }
  }

  /**
   * Один запрос к модели: сначала как к чату (если у GGUF есть chat-шаблон),
   * иначе — обычным продолжением текста.
   */
  private async ask(engine: Wllama, prompt: string, maxTokens: number): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      try {
        const completion = await engine.createChatCompletion({
          messages: [
            { role: 'system', content: LOCAL_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          max_tokens: maxTokens,
          temperature: 0.2,
          top_k: 40,
          top_p: 0.9,
          abortSignal: controller.signal,
        });
        return completion.choices[0]?.message?.content ?? '';
      } catch (error) {
        if (controller.signal.aborted) throw error;
        // у модели может не быть chat-шаблона — продолжаем обычным completion
        const completion = await engine.createCompletion({
          prompt: `${LOCAL_SYSTEM_PROMPT}\n\n${prompt}\n\n`,
          max_tokens: maxTokens,
          temperature: 0.2,
          top_p: 0.9,
          abortSignal: controller.signal,
        });
        return completion.choices[0]?.text ?? '';
      }
    } finally {
      clearTimeout(timer);
    }
  }

  reset(): void {
    // у локальной модели нет долгоживущего контекста: каждый запрос независим
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const engine = this.engine;
    this.engine = null;
    this.loading = null;
    if (engine) await engine.exit().catch(() => undefined);
  }
}
