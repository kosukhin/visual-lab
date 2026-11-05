import type { BrainKind, ChatMessage } from '../types';
import { formatDate, nl2br, requireElement } from './dom';
import { ENGINE_ICON } from './hud';

export interface ChatHandlers {
  onSubmit(text: string): void;
  onFocusChange(focused: boolean): void;
  onShowVisualization(id: string): void;
}

/**
 * Чат с проводником. Пока он в фокусе, захват мыши отпускается,
 * чтобы можно было печатать.
 */
export class ChatPanel {
  private readonly root: HTMLElement;
  private readonly messages: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly form: HTMLFormElement;
  private readonly thinking: HTMLElement;
  private readonly thinkingLabel: HTMLElement;
  private readonly mode: HTMLElement;
  private readonly engineChip: HTMLElement;
  private engineLabel = 'проводник';
  private engineKind: BrainKind = 'demo';
  private readonly empty: HTMLElement;
  private readonly sendButton: HTMLButtonElement;

  constructor(host: HTMLElement, private readonly handlers: ChatHandlers) {
    this.root = document.createElement('section');
    this.root.className = 'chat';
    this.root.innerHTML = `
      <header class="chat__head">
        <span class="chat__avatar" aria-hidden="true"></span>
        <div class="chat__title">
          <div class="chat__title-row">
            <strong>Проводник</strong>
            <span class="chat__engine" data-engine="none" title="Какая модель отвечает">•</span>
          </div>
          <small class="chat__mode">проверяю модель…</small>
        </div>
        <button type="button" class="chat__collapse" title="Свернуть чат">–</button>
      </header>
      <div class="chat__messages" role="log" aria-live="polite">
        <div class="chat__empty">
          Скажите проводнику, что показать: «покажи солнечную систему», «нарисуй домик»,
          «визуализируй график y = x²».
        </div>
      </div>
      <div class="chat__thinking" hidden>
        <span class="chat__dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="chat__thinking-label">Проводник думает…</span>
      </div>
      <form class="chat__form" autocomplete="off">
        <input
          class="chat__input"
          type="text"
          name="message"
          placeholder="Что показать? (T — фокус)"
          autocomplete="off"
          enterkeyhint="send"
          maxlength="500"
        />
        <button class="chat__send" type="submit" aria-label="Отправить">→</button>
      </form>
    `;
    host.appendChild(this.root);

    this.messages = requireElement(this.root, '.chat__messages');
    this.input = requireElement<HTMLInputElement>(this.root, '.chat__input');
    this.form = requireElement<HTMLFormElement>(this.root, '.chat__form');
    this.thinking = requireElement(this.root, '.chat__thinking');
    this.thinkingLabel = requireElement(this.root, '.chat__thinking-label');
    this.mode = requireElement(this.root, '.chat__mode');
    this.engineChip = requireElement(this.root, '.chat__engine');
    this.empty = requireElement(this.root, '.chat__empty');
    this.sendButton = requireElement<HTMLButtonElement>(this.root, '.chat__send');

    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit();
    });

    this.input.addEventListener('focus', () => this.handlers.onFocusChange(true));
    this.input.addEventListener('blur', () => this.handlers.onFocusChange(false));
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.input.blur();
      }
    });

    requireElement<HTMLButtonElement>(this.root, '.chat__collapse').addEventListener('click', () => {
      this.root.classList.toggle('is-collapsed');
    });

    this.messages.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-viz]');
      const id = target?.dataset.viz;
      if (id) this.handlers.onShowVisualization(id);
    });
  }

  setMode(label: string): void {
    this.mode.textContent = label;
  }

  /** Показывает движок в шапке и запоминает его для подписей под ответами. */
  setEngine(kind: BrainKind, label: string): void {
    this.engineChip.dataset.engine = kind;
    this.engineChip.textContent = ENGINE_ICON[kind] ?? '•';
    this.engineChip.title =
      kind === 'nano'
        ? 'Gemini Nano — встроенная модель Chrome'
        : kind === 'local'
          ? 'Локальная модель в WebAssembly (wllama) — без Gemini Nano'
          : 'Демо-режим без ИИ';
    this.engineKind = kind;
    this.engineLabel =
      label ||
      (kind === 'nano' ? 'Gemini Nano' : kind === 'local' ? 'Локальная модель (WASM)' : 'Демо-режим');
  }

  setEnabled(enabled: boolean): void {
    this.input.disabled = !enabled;
    this.sendButton.disabled = !enabled;
    this.root.classList.toggle('is-disabled', !enabled);
  }

  addMessage(message: ChatMessage, viz?: { id: string; title: string }): void {
    this.empty.hidden = true;

    const wrapper = document.createElement('div');
    wrapper.className = `chat__message chat__message--${message.role}`;
    if (message.kind === 'error') wrapper.classList.add('is-error');
    if (message.kind === 'system') wrapper.classList.add('is-system');

    const bubble = document.createElement('div');
    bubble.className = 'chat__bubble';
    bubble.innerHTML = nl2br(message.text);
    wrapper.appendChild(bubble);

    if (viz) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chat__viz';
      chip.dataset.viz = viz.id;
      chip.innerHTML = `<span aria-hidden="true">▣</span> ${viz.title} — показать в мире`;
      wrapper.appendChild(chip);
    }

    if (message.role === 'conductor' && message.kind !== 'system') {
      const engine = document.createElement('span');
      engine.className = 'chat__engine-tag';
      engine.dataset.engine = this.engineKind;
      engine.textContent = this.engineLabel;
      wrapper.appendChild(engine);
    }

    const time = document.createElement('time');
    time.className = 'chat__time';
    time.textContent = formatDate(Date.now());
    wrapper.appendChild(time);

    this.messages.appendChild(wrapper);
    this.scrollToBottom();
  }

  setThinking(visible: boolean, label = 'Проводник думает…'): void {
    this.thinking.hidden = !visible;
    this.thinkingLabel.textContent = label;
    if (visible) this.scrollToBottom();
  }

  focus(): void {
    this.root.classList.remove('is-collapsed');
    this.input.focus();
    this.input.select();
  }

  blur(): void {
    this.input.blur();
  }

  get isInputFocused(): boolean {
    return document.activeElement === this.input;
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('is-hidden', !visible);
  }

  private submit(): void {
    const text = this.input.value.trim();
    if (!text || this.input.disabled) return;
    this.input.value = '';
    this.handlers.onSubmit(text);
  }

  private scrollToBottom(): void {
    this.messages.scrollTop = this.messages.scrollHeight;
  }
}
