import type { Visualization } from '../types';
import { escapeHtml, formatDate, requireElement } from './dom';

export interface GalleryHandlers {
  onShow(id: string): void;
  onDelete(id: string): void;
  onClose(): void;
}

/**
 * Галерея сохранённых визуализаций: список из SQLite + быстрые действия.
 */
export class GalleryPanel {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly counter: HTMLElement;

  constructor(host: HTMLElement, private readonly handlers: GalleryHandlers) {
    this.root = document.createElement('div');
    this.root.className = 'modal';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="modal__backdrop" data-action="close"></div>
      <aside class="modal__card gallery" role="dialog" aria-modal="true" aria-label="Галерея визуализаций">
        <header class="gallery__head">
          <div>
            <h2>Галерея</h2>
            <p class="gallery__counter">0 моделей</p>
          </div>
          <button type="button" class="button button--ghost" data-action="close">
            Закрыть <kbd>Esc</kbd>
          </button>
        </header>
        <div class="gallery__list"></div>
        <p class="gallery__empty" hidden>
          В базе пока нет визуализаций. Попросите проводника что-нибудь показать.
        </p>
      </aside>
    `;
    host.appendChild(this.root);

    this.list = requireElement(this.root, '.gallery__list');
    this.empty = requireElement(this.root, '.gallery__empty');
    this.counter = requireElement(this.root, '.gallery__counter');

    this.root.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      if (action === 'close') this.handlers.onClose();
      if (action === 'show' && target.dataset.id) this.handlers.onShow(target.dataset.id);
      if (action === 'delete' && target.dataset.id) this.handlers.onDelete(target.dataset.id);
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(items: Visualization[]): void {
    this.render(items);
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }

  private render(items: Visualization[]): void {
    this.counter.textContent = `${items.length} ${plural(items.length, 'модель', 'модели', 'моделей')} в базе`;
    this.empty.hidden = items.length > 0;

    this.list.innerHTML = items
      .map(
        (item) => `
        <article class="gallery__item">
          <div class="gallery__item-head">
            <strong>${escapeHtml(item.title)}</strong>
            <span class="gallery__badge gallery__badge--${item.source}">
              ${item.source === 'nano' ? 'Gemini Nano' : 'демо'}
            </span>
          </div>
          ${item.description ? `<p class="gallery__desc">${escapeHtml(item.description)}</p>` : ''}
          <div class="gallery__meta">
            ${formatDate(item.createdAt)} · ${item.spec.parts.length} ${plural(
              item.spec.parts.length,
              'часть',
              'части',
              'частей',
            )}
          </div>
          ${
            item.prompt
              ? `<div class="gallery__prompt">«${escapeHtml(item.prompt)}»</div>`
              : ''
          }
          <div class="gallery__actions">
            <button type="button" class="button button--primary" data-action="show" data-id="${item.id}">
              Показать
            </button>
            <button type="button" class="button button--ghost" data-action="delete" data-id="${item.id}">
              Удалить
            </button>
          </div>
        </article>
      `,
      )
      .join('');
  }
}

export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
