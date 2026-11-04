import * as THREE from 'three';

/**
 * Текстовая «табличка» в мире: рисуем её на canvas и вешаем как sprite,
 * чтобы она всегда была повёрнута к игроку.
 */

export interface TextSpriteOptions {
  color?: string;
  background?: string | null;
  fontSize?: number;
  maxWidth?: number;
  fontWeight?: string;
}

export interface TextSprite {
  sprite: THREE.Sprite;
  texture: THREE.CanvasTexture;
  aspect: number;
}

const FONT_STACK = '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif';

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

export function createTextSprite(text: string, options: TextSpriteOptions = {}): TextSprite {
  const color = options.color ?? '#e2eeff';
  const background = options.background === undefined ? 'rgba(10, 14, 26, 0.72)' : options.background;
  const fontSize = options.fontSize ?? 64;
  const fontWeight = options.fontWeight ?? '700';
  const maxWidth = options.maxWidth ?? 1024;
  const padding = Math.round(fontSize * 0.45);

  const measureCanvas = document.createElement('canvas');
  const measure = measureCanvas.getContext('2d');
  const font = `${fontWeight} ${fontSize}px ${FONT_STACK}`;
  if (measure) measure.font = font;
  const textWidth = measure ? measure.measureText(text).width : fontSize * text.length * 0.6;

  const width = Math.min(maxWidth, Math.ceil(textWidth + padding * 2));
  const height = Math.ceil(fontSize + padding * 1.3);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.clearRect(0, 0, width, height);
    if (background) {
      ctx.fillStyle = background;
      roundRect(ctx, 2, 2, width - 4, height - 4, Math.min(28, height / 2.6));
      ctx.fill();
      ctx.strokeStyle = 'rgba(127, 231, 255, 0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 6;
    ctx.fillText(text, width / 2, height / 2, width - padding);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 10;

  return { sprite, texture, aspect: width / height };
}
