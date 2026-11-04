import type {
  BrainHooks,
  BrainReply,
  ConductorBrain,
  Shape,
  Vec3,
  VisualizationSpec,
  VizPart,
} from '../types';

/**
 * Локальный «демо-проводник» — детерминированный планировщик на шаблонах.
 * Включается только если Gemini Nano в браузере недоступна: он позволяет
 * осмотреть мир, проверить сохранение в SQLite и галерею.
 */

const part = (
  shape: Shape,
  position: Vec3,
  scale: Vec3,
  color: string,
  extra: Partial<VizPart> = {},
): VizPart => ({ shape, position, scale, color, ...extra });

interface Template {
  keywords: string[];
  reply: string;
  build: () => VisualizationSpec;
}

const TEMPLATES: Template[] = [
  {
    keywords: ['дом', 'house', 'здан', 'коттедж'],
    reply: 'Собрал домик: корпус, крыша, дверь и светящееся окно.',
    build: () => ({
      title: 'Домик',
      description: 'Простой дом из примитивов: корпус, крыша, дверь и окно.',
      parts: [
        part('box', [0, 0.9, 0], [2, 1.8, 2], '#8d7361'),
        part('cone', [0, 2.25, 0], [2.9, 1.3, 2.9], '#c1503f'),
        part('box', [0, 0.55, 1.02], [0.5, 1.1, 0.08], '#4a2f24'),
        part('box', [0.62, 1.2, 1.02], [0.5, 0.5, 0.06], '#7fe7ff', { glow: true }),
        part('box', [-0.65, 2.45, -0.4], [0.26, 0.8, 0.26], '#6b4f45'),
      ],
    }),
  },
  {
    keywords: ['дерев', 'ёлк', 'елк', 'tree', 'лес'],
    reply: 'Вот ёлочка — ствол и три яруса кроны.',
    build: () => ({
      title: 'Ёлка',
      description: 'Ствол-цилиндр и три конуса кроны.',
      parts: [
        part('cylinder', [0, 0.6, 0], [0.3, 1.2, 0.3], '#8b5a2b'),
        part('cone', [0, 1.5, 0], [2, 1.4, 2], '#2f8f5b'),
        part('cone', [0, 2.2, 0], [1.6, 1.2, 1.6], '#37a86b'),
        part('cone', [0, 2.85, 0], [1.1, 1, 1.1], '#44c07c'),
        part('sphere', [0, 3.55, 0], [0.22, 0.22, 0.22], '#fbbf24', { glow: true }),
      ],
    }),
  },
  {
    keywords: ['солнечн', 'планет', 'solar', 'космос', 'orbit', 'орбит'],
    reply: 'Показываю солнечную систему: звезда, орбита и три планеты.',
    build: () => ({
      title: 'Солнечная система',
      description: 'Светящееся солнце, орбита и планеты разных размеров.',
      parts: [
        part('sphere', [0, 1.7, 0], [0.9, 0.9, 0.9], '#fbbf24', { glow: true }),
        part('torus', [0, 1.7, 0], [3.1, 3.1, 3.1], '#3b4a7a', {
          rotation: [Math.PI / 2, 0, 0],
          opacity: 0.75,
        }),
        part('sphere', [1.9, 1.7, 0.4], [0.34, 0.34, 0.34], '#4ea1ff'),
        part('sphere', [-1.2, 1.7, 1.6], [0.5, 0.5, 0.5], '#c1503f'),
        part('sphere', [0.2, 1.7, -2.4], [0.26, 0.26, 0.26], '#8ea8ff'),
      ],
    }),
  },
  {
    keywords: ['молекул', 'атом', 'molecule', 'chem', 'хим'],
    reply: 'Молекула: центральный атом, связи и четыре спутника.',
    build: () => ({
      title: 'Молекула',
      description: 'Центральный атом, четыре связи и атомы-спутники.',
      parts: [
        part('sphere', [0, 1.8, 0], [0.7, 0.7, 0.7], '#7fe7ff', { glow: true }),
        part('box', [0.8, 1.8, 0], [1, 0.12, 0.12], '#94a3b8'),
        part('box', [-0.8, 1.8, 0], [1, 0.12, 0.12], '#94a3b8'),
        part('box', [0, 1.8, 0.8], [0.12, 0.12, 1], '#94a3b8'),
        part('box', [0, 2.6, 0], [0.12, 1, 0.12], '#94a3b8'),
        part('sphere', [1.6, 1.8, 0], [0.42, 0.42, 0.42], '#f472b6'),
        part('sphere', [-1.6, 1.8, 0], [0.42, 0.42, 0.42], '#34d399'),
        part('sphere', [0, 1.8, 1.6], [0.42, 0.42, 0.42], '#fbbf24'),
        part('sphere', [0, 3.4, 0], [0.42, 0.42, 0.42], '#8b5cf6'),
      ],
    }),
  },
  {
    keywords: ['график', 'диаграмм', 'chart', 'статистик', 'данн'],
    reply: 'Столбчатая диаграмма по пяти значениям — высота столбца равна значению.',
    build: () => {
      const values = [0.9, 1.7, 1.2, 2.4, 1.5];
      const colors = ['#4ea1ff', '#7fe7ff', '#34d399', '#fbbf24', '#f472b6'];
      const bars = values.map((value, index) =>
        part(
          'box',
          [-1.6 + index * 0.8, value / 2, 0],
          [0.55, value, 0.55],
          colors[index] ?? '#4ea1ff',
        ),
      );
      return {
        title: 'Диаграмма',
        description: 'Пять столбцов разной высоты на общей базе.',
        parts: [...bars, part('box', [0, 0.04, 0], [4, 0.08, 0.9], '#1e2a4a')],
      };
    },
  },

  {
    keywords: ['спираль', 'днк', 'dna', 'helix', 'винт'],
    reply: 'Двойная спираль: две ленты из сфер и перемычки между ними.',
    build: () => {
      const parts: VizPart[] = [];
      const steps = 10;
      const colors = ['#4ea1ff', '#f472b6'];
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2.2;
        const y = 0.5 + i * 0.28;
        for (let side = 0; side < 2; side++) {
          const phase = angle + side * Math.PI;
          parts.push(
            part(
              'sphere',
              [Math.cos(phase) * 0.9, y, Math.sin(phase) * 0.9],
              [0.22, 0.22, 0.22],
              colors[side] ?? '#4ea1ff',
              side === 0 ? { glow: true } : {},
            ),
          );
        }
        parts.push(
          part('box', [0, y, 0], [Math.abs(Math.cos(angle)) * 1.8 + 0.1, 0.06, 0.06], '#94a3b8', {
            rotation: [0, -angle, 0],
            opacity: 0.8,
          }),
        );
      }
      return {
        title: 'Двойная спираль',
        description: 'Две ленты из сфер, соединённые перемычками.',
        parts,
      };
    },
  },
  {
    keywords: ['парабол', 'функц', 'крив', 'graph'],
    reply: 'График функции y = x², нарисованный линией.',
    build: () => ({
      title: 'График y = x²',
      description: 'Парабола из ломаной линии и оси координат.',
      parts: [
        part('line', [0, 0, 0], [1, 1, 1], '#7fe7ff', {
          points: Array.from({ length: 21 }, (_, i) => {
            const x = -1.8 + (i / 20) * 3.6;
            return [x, 0.4 + (x * x) / 2, 0] as Vec3;
          }),
        }),
        part('box', [0, 0.36, 0], [4, 0.04, 0.04], '#3b4a7a'),
        part('box', [0, 1.7, 0], [0.04, 2.7, 0.04], '#3b4a7a'),
      ],
    }),
  },
  {
    keywords: ['глобус', 'земл', 'earth', 'globe', 'шар'],
    reply: 'Глобус: сфера, кольцо орбиты и подпись.',
    build: () => ({
      title: 'Глобус',
      description: 'Сфера с орбитальным кольцом и подписью.',
      parts: [
        part('sphere', [0, 1.7, 0], [1.8, 1.8, 1.8], '#3b82f6'),
        part('torus', [0, 1.7, 0], [2.4, 2.4, 2.4], '#7fe7ff', {
          rotation: [Math.PI / 2.6, 0, 0.3],
          opacity: 0.8,
        }),
        part('text', [0, 3.35, 0], [1, 1, 1], '#e2eeff', { text: 'Земля' }),
      ],
    }),
  },
  {
    keywords: ['куб', 'cube', 'бокс', 'box', 'квадрат'],
    reply: 'Вот куб: каркас и светящееся ядро внутри.',
    build: () => ({
      title: 'Куб',
      description: 'Каркасный куб с ярким ядром в центре.',
      parts: [
        part('box', [0, 1.7, 0], [1.8, 1.8, 1.8], '#4ea1ff', { wireframe: true }),
        part('sphere', [0, 1.7, 0], [0.55, 0.55, 0.55], '#7fe7ff', { glow: true }),
      ],
    }),
  },
];

const DEFAULT_SPEC = (): VisualizationSpec => ({
  title: 'Октаэдр',
  description: 'Базовая фигура на случай, если запрос не распознан.',
  parts: [
    part('octahedron', [0, 1.8, 0], [1.7, 1.7, 1.7], '#8b5cf6', { glow: true }),
    part('torus', [0, 0.15, 0], [2.2, 2.2, 2.2], '#3b4a7a', {
      rotation: [Math.PI / 2, 0, 0],
      opacity: 0.6,
    }),
  ],
});

const GREETING = /^(привет|здравств|хай|hello|hi|добрый)/i;
const THANKS = /(спасибо|благодар|thanks)/i;

const DEMO_HINT =
  'В демо-режиме доступны: дом, ёлка, солнечная система, молекула, диаграмма, спираль, график, глобус и куб.';

export class DemoBrain implements ConductorBrain {
  readonly kind = 'demo' as const;
  readonly label = 'Локальный демо-планировщик';

  async chat(userText: string, hooks?: BrainHooks): Promise<BrainReply> {
    hooks?.onStatus?.('thinking');
    const text = userText.trim();
    const lower = text.toLowerCase();

    if (!text) return { reply: 'Я слушаю.', visualization: null };

    if (THANKS.test(lower)) {
      return {
        reply: 'Пожалуйста! Модели сохраняются в базе — открыть список можно клавишей G.',
        visualization: null,
      };
    }
    if (GREETING.test(lower) && text.length < 30) {
      return {
        reply: `Привет! Я работаю в демо-режиме: Gemini Nano в этом браузере недоступна. ${DEMO_HINT}`,
        visualization: null,
      };
    }

    hooks?.onStatus?.('drawing');
    const template = TEMPLATES.find((item) =>
      item.keywords.some((keyword) => lower.includes(keyword)),
    );
    const spec = template ? template.build() : DEFAULT_SPEC();
    const reply = template
      ? template.reply
      : `Точного шаблона нет — показываю базовую фигуру. ${DEMO_HINT}`;

    return { reply, visualization: spec };
  }

  reset(): void {
    /* у демо-проводника нет состояния */
  }

  dispose(): void {
    /* нечего освобождать */
  }
}
