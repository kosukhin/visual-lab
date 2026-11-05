import type { BrainKind } from '../types';
import { escapeHtml, requireElement } from './dom';

type Tone = 'neutral' | 'good' | 'warn' | 'bad';

/** Иконка движка: видно сразу, кто именно отвечает. */
export const ENGINE_ICON: Record<BrainKind, string> = {
  nano: '⚡',
  local: '🧠',
  demo: '🎭',
};

export type HudAction = 'gallery' | 'database' | 'help';

/**
 * Верхний слой интерфейса: статусы, кнопки, подсказки и всплывающие сообщения.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly brainValue: HTMLElement;
  private readonly brainStat: HTMLElement;
  private readonly brainIcon: HTMLElement;
  private readonly dbValue: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly crosshair: HTMLElement;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud__brand">
        <span class="hud__logo" aria-hidden="true"></span>
        <div class="hud__brand-text">
          <strong>Visual Lab</strong>
          <small>лаборатория проводника</small>
        </div>
      </div>
      <div class="hud__stats">
        <div class="hud__stat" data-stat="brain" data-engine="none">
          <span class="hud__stat-icon" aria-hidden="true">•</span>
          <span class="hud__stat-label">Проводник</span>
          <span class="hud__stat-value">проверяю…</span>
        </div>
        <div class="hud__stat" data-stat="db">
          <span class="hud__stat-label">База</span>
          <span class="hud__stat-value">не выбрана</span>
        </div>
      </div>
      <div class="hud__actions">
        <button type="button" class="hud__button" data-action="gallery">Галерея <kbd>G</kbd></button>
        <button type="button" class="hud__button" data-action="database">База</button>
        <button type="button" class="hud__button" data-action="help">Управление</button>
      </div>
      <div class="hud__crosshair" aria-hidden="true"></div>
      <div class="hud__hint"></div>
      <div class="hud__toasts" role="status" aria-live="polite"></div>
    `;
    host.appendChild(this.root);

    this.brainValue = requireElement(this.root, '[data-stat="brain"] .hud__stat-value');
    this.brainStat = requireElement(this.root, '[data-stat="brain"]');
    this.brainIcon = requireElement(this.root, '[data-stat="brain"] .hud__stat-icon');
    this.dbValue = requireElement(this.root, '[data-stat="db"] .hud__stat-value');
    this.hint = requireElement(this.root, '.hud__hint');
    this.toasts = requireElement(this.root, '.hud__toasts');
    this.crosshair = requireElement(this.root, '.hud__crosshair');
  }

  onAction(handler: (action: HudAction) => void): void {
    this.root.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
      const action = target?.dataset.action as HudAction | undefined;
      if (action) handler(action);
    });
  }

  setBrainStatus(text: string, tone: Tone = 'neutral'): void {
    this.setValue(this.brainValue, text, tone);
  }

  /** Проводник ещё не подключён: без иконки движка, чтобы не путать с демо. */
  setEnginePending(text: string): void {
    this.brainStat.dataset.engine = 'none';
    this.brainIcon.textContent = '•';
    this.brainValue.textContent = text;
    this.brainValue.dataset.tone = 'warn';
    this.brainStat.title = 'Проводник ещё не подключён — выберите модель';
  }

  /**
   * Явно показывает, каким движком отвечает проводник.
   * Иконка + название + цвет: ⚡ Gemini Nano, 🧠 локальная WASM-модель, 🎭 демо.
   */
  setEngine(kind: BrainKind, label: string): void {
    this.brainStat.dataset.engine = kind;
    this.brainIcon.textContent = ENGINE_ICON[kind] ?? '•';
    this.brainValue.textContent = label;
    this.brainValue.dataset.tone = kind === 'nano' ? 'good' : kind === 'local' ? 'warn' : 'neutral';
    this.brainStat.title =
      kind === 'nano'
        ? 'Проводник работает на Gemini Nano (встроенная модель Chrome)'
        : kind === 'local'
          ? 'Проводник работает на локальной модели в WebAssembly (wllama), без Gemini Nano'
          : 'Демо-режим: ответы из шаблонов, без ИИ';
  }

  setDbStatus(text: string, tone: Tone = 'neutral'): void {
    this.setValue(this.dbValue, text, tone);
  }

  setHint(text: string): void {
    this.hint.innerHTML = text;
  }

  setCrosshairVisible(visible: boolean): void {
    this.crosshair.classList.toggle('is-visible', visible);
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('is-hidden', !visible);
  }

  toast(message: string, tone: 'info' | 'error' = 'info', timeout = 4200): void {
    const node = document.createElement('div');
    node.className = `toast toast--${tone}`;
    node.innerHTML = escapeHtml(message);
    this.toasts.appendChild(node);
    window.setTimeout(() => node.classList.add('is-leaving'), timeout);
    window.setTimeout(() => node.remove(), timeout + 400);
  }

  private setValue(element: HTMLElement, text: string, tone: Tone): void {
    element.textContent = text;
    element.dataset.tone = tone;
  }
}
