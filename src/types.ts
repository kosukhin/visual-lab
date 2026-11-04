/**
 * Общие типы приложения.
 *
 * Визуализация — это компактная декларативная «спека» из примитивов three.js.
 * Именно в таком виде её генерирует Gemini Nano и в таком же виде она лежит
 * в SQLite (JSON-колонка `spec`), поэтому рендер детерминирован и не зависит
 * от версии модели.
 */

export type Vec3 = [number, number, number];

/** Примитивы, которые умеет рисовать движок визуализаций. */
export const SHAPES = [
  'box',
  'sphere',
  'cylinder',
  'cone',
  'torus',
  'capsule',
  'plane',
  'octahedron',
  'text',
  'line',
] as const;

export type Shape = (typeof SHAPES)[number];

export interface VizPart {
  shape: Shape;
  /** Позиция в метрах: x — вправо, y — вверх, z — на зрителя. */
  position?: Vec3;
  /** Поворот в радианах. */
  rotation?: Vec3;
  /** Масштаб [ширина, высота, глубина]. */
  scale?: Vec3;
  /** Цвет в формате #rrggbb. */
  color?: string;
  /** Текст для shape === 'text'. */
  text?: string;
  /** Точки для shape === 'line'. */
  points?: Vec3[];
  /** 0..1, по умолчанию 1. */
  opacity?: number;
  /** Светящийся материал (emissive). */
  glow?: boolean;
  wireframe?: boolean;
}

export interface VisualizationSpec {
  title: string;
  description: string;
  parts: VizPart[];
}

/** Сохранённая в SQLite визуализация. */
export interface Visualization {
  id: string;
  title: string;
  description: string;
  /** Исходный запрос пользователя. */
  prompt: string;
  spec: VisualizationSpec;
  createdAt: number;
  /** Источник: Gemini Nano, локальная WASM-модель или демо-планировщик. */
  source: BrainKind;
}

export type ChatRole = 'user' | 'conductor';

/** Кто отвечает пользователю. */
export type BrainKind = 'nano' | 'local' | 'demo';

export interface ChatMessage {
  role: ChatRole;
  text: string;
  /** Сообщение-служебное (ошибка, статус) — рисуется иначе. */
  kind?: 'normal' | 'error' | 'system';
  vizId?: string;
}

export type ConductorStatus = 'idle' | 'thinking' | 'drawing' | 'speaking';

export interface BrainReply {
  reply: string;
  visualization: VisualizationSpec | null;
}

export interface BrainHooks {
  onStatus?: (status: ConductorStatus) => void;
}

/** «Мозг» проводника: Gemini Nano или офлайн-заглушка. */
export interface ConductorBrain {
  readonly kind: BrainKind;
  readonly label: string;
  chat(userText: string, hooks?: BrainHooks): Promise<BrainReply>;
  reset(): void;
  dispose(): void;
}
