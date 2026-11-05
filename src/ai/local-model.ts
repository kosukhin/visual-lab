/**
 * Локальная модель на WebAssembly (llama.cpp через wllama).
 *
 * Модель НЕ входит в сборку: пользователь скачивает GGUF с HuggingFace один раз,
 * дальше движок берёт её из Cache Storage и работает офлайн.
 */
import type { CacheManager } from '@wllama/wllama/esm/index.js';

export interface LocalModelPreset {
  id: string;
  label: string;
  /** Короткое имя для интерфейса (подпись над проводником). */
  shortLabel: string;
  repo: string;
  file: string;
  /** Размер файла в мегабайтах (ориентир для UI). */
  sizeMb: number;
  license: string;
}

export const DEFAULT_LOCAL_MODEL: LocalModelPreset = {
  id: 'qwen2.5-0.5b-instruct-q4_0',
  label: 'Qwen2.5-0.5B-Instruct (Q4_0)',
  shortLabel: 'Qwen2.5-0.5B (WASM)',
  repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
  file: 'qwen2.5-0.5b-instruct-q4_0.gguf',
  sizeMb: 409,
  license: 'Apache-2.0',
};

/** Ключ, которым можно подменить модель (удобно для тестов и экспериментов). */
const MODEL_URL_OVERRIDE_KEY = 'visual-lab:local-model-url';

export function localModelUrl(preset: LocalModelPreset = DEFAULT_LOCAL_MODEL): string {
  try {
    const override = window.localStorage.getItem(MODEL_URL_OVERRIDE_KEY);
    if (override && override.startsWith('http')) return override;
  } catch {
    /* localStorage может быть недоступен */
  }
  return `https://huggingface.co/${preset.repo}/resolve/main/${preset.file}`;
}

export interface LocalModelInfo {
  cached: boolean;
  bytes: number;
}

type WllamaModule = typeof import('@wllama/wllama/esm/index.js');

let wllamaModule: Promise<WllamaModule> | null = null;

/** wllama весит ~380 КБ JS, поэтому грузим его только когда он реально нужен. */
function loadWllama(): Promise<WllamaModule> {
  wllamaModule ??= import('@wllama/wllama/esm/index.js');
  return wllamaModule;
}

const READY_KEY = 'visual-lab:local-model-ready';

export interface LocalModelFlag {
  url: string;
  bytes: number;
}

/** Быстрая проверка «модель уже скачивали» без загрузки движка. */
export function readLocalModelFlag(): LocalModelFlag | null {
  try {
    const raw = window.localStorage.getItem(READY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalModelFlag>;
    if (typeof parsed.url !== 'string') return null;
    return { url: parsed.url, bytes: Number(parsed.bytes) || 0 };
  } catch {
    return null;
  }
}

export function writeLocalModelFlag(url: string, bytes: number): void {
  try {
    window.localStorage.setItem(READY_KEY, JSON.stringify({ url, bytes }));
  } catch {
    /* localStorage может быть недоступен */
  }
}

export function clearLocalModelFlag(): void {
  try {
    window.localStorage.removeItem(READY_KEY);
  } catch {
    /* не критично */
  }
}

let cacheManager: CacheManager | null = null;

async function getCacheManager(): Promise<CacheManager> {
  if (!cacheManager) {
    const { CacheManager } = await loadWllama();
    cacheManager = new CacheManager();
  }
  return cacheManager;
}

/** Проверяет, лежит ли модель в кэше (Cache Storage / IndexedDB). */
export async function inspectLocalModel(url: string): Promise<LocalModelInfo> {
  try {
    const { ModelManager } = await loadWllama();
    const manager = new ModelManager({ cacheManager: await getCacheManager() });
    const models = await manager.getModels();
    const model = models.find((item) => item.url === url);
    if (!model || model.size <= 0) return { cached: false, bytes: 0 };
    return { cached: true, bytes: model.size };
  } catch (error) {
    console.warn('[visual-lab] не удалось проверить кэш локальной модели', error);
    return { cached: false, bytes: 0 };
  }
}

/** Удаляет модель из кэша, освобождая место. */
export async function removeLocalModel(url: string): Promise<void> {
  const cache = await getCacheManager();
  try {
    await cache.delete(url);
    clearLocalModelFlag();
  } catch (error) {
    console.warn('[visual-lab] не удалось удалить модель из кэша', error);
    throw error;
  }
}

/** Сколько места занято на origin (для подсказки в UI). */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 МБ';
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(1)} ГБ`;
  return `${Math.round(megabytes)} МБ`;
}
