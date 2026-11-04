import { escapeHtml, requireElement } from './dom';

type Tone = 'neutral' | 'good' | 'warn' | 'bad';

export type HudAction = 'gallery' | 'database' | 'help';

/**
 * Верхний слой интерфейса: статусы, кнопки, подсказки и всплывающие сообщения.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly brainValue: HTMLElement;
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
        <div class="hud__stat" data-stat="brain">
          <span class="hud__stat-label">ИИ</span>
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
