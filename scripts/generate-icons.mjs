#!/usr/bin/env node
/**
 * Генератор иконок PWA без сторонних зависимостей: рисуем человечка-проводника
 * из квадратиков в RGBA-буфер и кодируем в PNG (zlib + CRC32).
 *
 * Запуск: npm run icons
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ PNG ---- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}


/* -------------------------------------------------------------- drawing ---- */

function createCanvas(size) {
  return { size, data: new Float32Array(size * size * 4) };
}

function blend(canvas, x, y, color, alpha = 1) {
  const { size, data } = canvas;
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  const a = Math.max(0, Math.min(1, alpha));
  data[i] = data[i] * (1 - a) + color[0] * a;
  data[i + 1] = data[i + 1] * (1 - a) + color[1] * a;
  data[i + 2] = data[i + 2] * (1 - a) + color[2] * a;
  data[i + 3] = data[i + 3] * (1 - a) + 255 * a;
}

/** Прямоугольник в нормализованных координатах (0..1). */
function rect(canvas, x0, y0, x1, y1, color, alpha = 1) {
  const s = canvas.size;
  const px0 = Math.round(x0 * s);
  const px1 = Math.round(x1 * s);
  const py0 = Math.round(y0 * s);
  const py1 = Math.round(y1 * s);
  for (let y = py0; y < py1; y++) {
    for (let x = px0; x < px1; x++) blend(canvas, x, y, color, alpha);
  }
}

function gradient(canvas, top, bottom, glow = null) {
  const s = canvas.size;
  for (let y = 0; y < s; y++) {
    const t = y / (s - 1);
    for (let x = 0; x < s; x++) {
      let r = top[0] + (bottom[0] - top[0]) * t;
      let g = top[1] + (bottom[1] - top[1]) * t;
      let b = top[2] + (bottom[2] - top[2]) * t;
      if (glow) {
        const dx = (x / s - glow.x) / glow.radius;
        const dy = (y / s - glow.y) / glow.radius;
        const d = Math.sqrt(dx * dx + dy * dy);
        const k = Math.max(0, 1 - d) ** 2 * glow.strength;
        r += (glow.color[0] - r) * k;
        g += (glow.color[1] - g) * k;
        b += (glow.color[2] - b) * k;
      }
      const i = (y * s + x) * 4;
      canvas.data[i] = r;
      canvas.data[i + 1] = g;
      canvas.data[i + 2] = b;
      canvas.data[i + 3] = 255;
    }
  }
}

function downsample(canvas, factor) {
  const s = canvas.size;
  const out = s / factor;
  const rgba = new Uint8Array(out * out * 4);
  const src = canvas.data;
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * s + (x * factor + dx)) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
        }
      }
      const n = factor * factor;
      const o = (y * out + x) * 4;
      rgba[o] = Math.round(r / n);
      rgba[o + 1] = Math.round(g / n);
      rgba[o + 2] = Math.round(b / n);
      rgba[o + 3] = Math.round(a / n);
    }
  }
  return { width: out, height: out, rgba };
}

/* ------------------------------------------------------------- artwork ----- */

const INK = [10, 14, 26];
const HEAD = [226, 238, 255];
const EYE = [34, 230, 255];
const TORSO = [91, 124, 255];
const ARM = [74, 104, 224];
const LEG = [142, 168, 255];
const ACCENT = [127, 231, 255];

function drawConductor(canvas, scale = 1) {
  // scale == 1 — фигура занимает "безопасную" область целиком,
  // scale < 1 — уменьшаем вокруг центра (для maskable-иконки).
  const c = 0.5;
  const px = (v) => c + (v - c) * scale;
  const box = (x0, y0, x1, y1, color, alpha = 1) =>
    rect(canvas, px(x0), px(y0), px(x1), px(y1), color, alpha);

  // тень под ногами
  box(0.33, 0.855, 0.67, 0.885, [0, 0, 0], 0.35);
  // ноги
  box(0.4, 0.7, 0.475, 0.865, LEG);
  box(0.525, 0.7, 0.6, 0.865, LEG);
  // руки
  box(0.285, 0.445, 0.345, 0.64, ARM);
  box(0.655, 0.445, 0.715, 0.64, ARM);
  // корпус
  box(0.36, 0.42, 0.64, 0.69, TORSO);
  // «экранчик» на груди
  box(0.445, 0.49, 0.555, 0.575, ACCENT, 0.9);
  // антенна
  box(0.492, 0.155, 0.508, 0.2, ACCENT);
  box(0.468, 0.105, 0.532, 0.155, ACCENT);
  // голова
  box(0.375, 0.195, 0.625, 0.4, HEAD);
  // глаза
  box(0.425, 0.275, 0.475, 0.315, EYE);
  box(0.525, 0.275, 0.575, 0.315, EYE);
  // «рот»
  box(0.465, 0.345, 0.535, 0.363, INK, 0.55);
  // парящий кубик визуализации справа
  box(0.775, 0.325, 0.885, 0.435, ACCENT, 0.95);
  box(0.775, 0.325, 0.885, 0.35, [255, 255, 255], 0.45);
}

function renderIcon(size, { maskable = false } = {}) {
  const SS = 3;
  const canvas = createCanvas(size * SS);
  gradient(canvas, [24, 16, 44], [8, 11, 22], {
    x: 0.5,
    y: 0.42,
    radius: 0.62,
    strength: 0.35,
    color: [42, 92, 180],
  });
  if (!maskable) {
    // лёгкие светящиеся полосы сверху/снизу
    rect(canvas, 0, 0, 1, 0.012, ACCENT, 0.08);
    rect(canvas, 0, 0.988, 1, 1, ACCENT, 0.08);
  }
  drawConductor(canvas, maskable ? 0.68 : 0.92);
  const { width, height, rgba } = downsample(canvas, SS);
  return encodePng(width, height, rgba);
}

const outDir = resolve(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
];

for (const [name, size, options] of targets) {
  const png = renderIcon(size, options);
  writeFileSync(resolve(outDir, name), png);
  console.log(`✓ public/icons/${name} (${(png.length / 1024).toFixed(1)} KB)`);
}
