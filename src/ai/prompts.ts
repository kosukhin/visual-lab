import { SHAPES, type Shape, type Vec3, type VisualizationSpec, type VizPart } from '../types';

/**
 * Системный промпт проводника. Держим его коротким: у Gemini Nano небольшое
 * контекстное окно, и каждый лишний абзац замедляет ответ.
 */
export const CONDUCTOR_SYSTEM_PROMPT = `Ты — Проводник, ИИ-аватар Gemini Nano в 3D-лаборатории Visual Lab. Ты всегда идёшь рядом с пользователем и помогаешь ему.
Правила:
- Говори на языке сообщения пользователя (обычно по-русски), дружелюбно и очень кратко: 1–2 предложения.
- Действия в мире (осмотреться, показать, нарисовать, визуализировать) ты выполняешь, создавая 3D-модель из примитивов.
- Ты не человек и не имеешь тела, но у тебя есть аватар в мире. Не выдумывай факты о мире пользователя.`;

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Короткий ответ проводника на языке пользователя' },
    action: {
      type: 'string',
      enum: ['none', 'visualize'],
      description: 'visualize — если нужно показать 3D-модель',
    },
    request: {
      type: 'string',
      description: 'Что именно нужно визуализировать (кратко, для шага рисования)',
    },
  },
  required: ['reply', 'action', 'request'],
  additionalProperties: false,
} as const;

const VEC3_SCHEMA = {
  type: 'array',
  items: { type: 'number' },
  minItems: 3,
  maxItems: 3,
} as const;

export const VIZ_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    parts: {
      type: 'array',
      minItems: 1,
      maxItems: 24,
      items: {
        type: 'object',
        properties: {
          shape: { type: 'string', enum: [...SHAPES] },
          position: VEC3_SCHEMA,
          rotation: VEC3_SCHEMA,
          scale: VEC3_SCHEMA,
          color: { type: 'string' },
          text: { type: 'string' },
          points: {
            type: 'array',
            items: VEC3_SCHEMA,
            maxItems: 24,
          },
          opacity: { type: 'number', minimum: 0, maximum: 1 },
          glow: { type: 'boolean' },
          wireframe: { type: 'boolean' },
        },
        required: ['shape', 'position', 'scale'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'description', 'parts'],
  additionalProperties: false,
} as const;

export function buildPlanPrompt(userText: string): string {
  return `Сообщение пользователя: "${userText}"

Ответь JSON по схеме:
{"reply": "...", "action": "none" | "visualize", "request": "краткое ТЗ на модель"}
action = "visualize", если пользователь просит что-то показать, нарисовать, изобразить, объяснить наглядно.`;
}

export function buildSpecPrompt(request: string): string {
  return `Создай 3D-модель по заданию: "${request}".

Только примитивы three.js:
- "box", "sphere", "cylinder", "cone", "torus", "capsule", "plane", "octahedron" — геометрия;
- "text" — 3D-подпись (используй поле text);
- "line" — ломаная линия (поля points и color).

Ограничения:
- Модель должна помещаться в куб 3x3x3 с центром в точке (0, 1.6, 0). Координаты в метрах: y вверх, z на зрителя.
- scale = [ширина, высота, глубина] каждого примитива, не больше 3.
- color — строго hex вида "#4ea1ff".
- Максимум 20 частей. Собирай узнаваемую форму: например, дом = box (корпус) + cone (крыша) + box (дверь).
- title — 2–4 слова, description — одно короткое предложение по-русски.`;
}

const FALLBACK_PALETTE = ['#4ea1ff', '#7fe7ff', '#8b5cf6', '#f472b6', '#fbbf24', '#34d399'];

const CSS_COLORS: Record<string, string> = {
  red: '#ef4444',
  green: '#22c55e',
  blue: '#3b82f6',
  yellow: '#eab308',
  orange: '#f97316',
  purple: '#a855f7',
  violet: '#8b5cf6',
  pink: '#ec4899',
  cyan: '#22d3ee',
  teal: '#14b8a6',
  white: '#f8fafc',
  black: '#0b1220',
  gray: '#94a3b8',
  grey: '#94a3b8',
  brown: '#a16207',
  gold: '#fbbf24',
  silver: '#cbd5e1',
};

export function parseColor(raw: unknown, fallbackIndex = 0): string {
  const fallback = FALLBACK_PALETTE[fallbackIndex % FALLBACK_PALETTE.length] ?? '#4ea1ff';
  if (typeof raw !== 'string') return fallback;
  const value = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  const named = CSS_COLORS[value];
  if (named) return named;
  const rgb = value.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (rgb) {
    const channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    return `#${channels
      .map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0'))
      .join('')}`;
  }
  return fallback;
}

function toNum(raw: unknown, fallback: number, min: number, max: number): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function toVec3(raw: unknown, fallback: Vec3, min: number, max: number): Vec3 {
  if (!Array.isArray(raw) || raw.length < 3) return fallback;
  return [
    toNum(raw[0], fallback[0], min, max),
    toNum(raw[1], fallback[1], min, max),
    toNum(raw[2], fallback[2], min, max),
  ];
}

function isShape(raw: unknown): raw is Shape {
  return typeof raw === 'string' && (SHAPES as readonly string[]).includes(raw);
}

/** Достаёт JSON из ответа модели (иногда она заворачивает его в ```json). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('в ответе модели нет JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Приводит «сырую» спеку от модели к безопасному виду: любые странные числа,
 * цвета и формы превращаются в предсказуемую геометрию.
 */
export function normalizeSpec(raw: unknown): VisualizationSpec {
  if (!raw || typeof raw !== 'object') throw new Error('модель вернула не объект');
  const record = raw as Record<string, unknown>;
  const rawParts = Array.isArray(record.parts) ? record.parts : [];
  const parts: VizPart[] = [];

  rawParts.slice(0, 24).forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const part = item as Record<string, unknown>;
    if (!isShape(part.shape)) return;

    const normalized: VizPart = {
      shape: part.shape,
      position: toVec3(part.position, [0, 1.6, 0], -8, 8),
      scale: toVec3(part.scale, [1, 1, 1], 0.05, 6),
      color: parseColor(part.color, index),
    };

    if (part.rotation) {
      normalized.rotation = toVec3(part.rotation, [0, 0, 0], -Math.PI * 4, Math.PI * 4);
    }
    if (typeof part.opacity === 'number') normalized.opacity = toNum(part.opacity, 1, 0.05, 1);
    if (part.glow === true) normalized.glow = true;
    if (part.wireframe === true) normalized.wireframe = true;
    if (typeof part.text === 'string' && part.text.trim()) {
      normalized.text = part.text.trim().slice(0, 48);
    }
    if (part.shape === 'text' && !normalized.text) normalized.text = 'text';
    if (part.shape === 'line') {
      const points = Array.isArray(part.points)
        ? part.points.slice(0, 24).map((p) => toVec3(p, [0, 0, 0], -8, 8))
        : [];
      normalized.points =
        points.length >= 2
          ? points
          : [
              [-1, 1.6, 0],
              [1, 1.6, 0],
            ];
    }

    parts.push(normalized);
  });

  if (parts.length === 0) throw new Error('модель не вернула ни одной части модели');

  const title =
    typeof record.title === 'string' && record.title.trim()
      ? record.title.trim().slice(0, 60)
      : 'Визуализация';
  const description =
    typeof record.description === 'string' ? record.description.trim().slice(0, 200) : '';

  return { title, description, parts };
}
