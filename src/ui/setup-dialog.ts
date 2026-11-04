import { requireElement } from './dom';

export type Tone = 'neutral' | 'good' | 'warn' | 'bad';

export interface ModelState {
  badge: string;
  tone: Tone;
  note: string;
  downloadVisible: boolean;
  downloadLabel: string;
  downloadDisabled?: boolean;
  demoVisible: boolean;
  demoLabel?: string;
  /** 0..1 или null, если загрузки нет. */
  progress: number | null;
}

export interface DbState {
  badge: string;
  tone: Tone;
  note: string;
  createLabel: string;
  createDisabled?: boolean;
  openLabel: string;
  openDisabled?: boolean;
  /** Подпись кнопки «продолжить с прошлым файлом» (null — кнопка скрыта). */
  resumeLabel: string | null;
  /** Подпись кнопки «хранить в браузере» (null — кнопка скрыта). */
  idbLabel: string | null;
}

export interface SetupHandlers {
  onDownloadModel(): void;
  onUseDemo(): void;
  onCreateDatabase(): void;
  onOpenDatabase(): void;
  onResumeDatabase(): void;
  onCreateIdbDatabase(): void;
  onEnter(): void;
}

const TEMPLATE = `
  <div class="modal__backdrop"></div>
  <div class="modal__card setup" role="dialog" aria-modal="true" aria-labelledby="setup-title">
    <header class="setup__head">
      <span class="setup__logo" aria-hidden="true"></span>
      <div>
        <h1 id="setup-title">Visual Lab</h1>
        <p class="setup__lead">
          Я — ваш проводник. Хожу рядом в 3D-мире, отвечаю на вопросы и собираю визуализации из
          3D-примитивов. Чтобы модели не потерялись, я сохраняю их в ваш файл SQLite.
        </p>
      </div>
    </header>

    <section class="setup__section">
      <div class="setup__section-head">
        <h2>1 · ИИ-проводник</h2>
        <span class="badge" data-bind="model-badge" data-tone="neutral">проверяю…</span>
      </div>
      <p class="setup__note" data-bind="model-note">Смотрю, доступна ли Gemini Nano в браузере…</p>
      <div class="progress" data-bind="model-progress" hidden>
        <div class="progress__track"><div class="progress__bar"></div></div>
        <span class="progress__label">0%</span>
      </div>
      <div class="setup__row">
        <button type="button" class="button button--primary" data-action="download">
          Скачать модель Gemini Nano
        </button>
        <button type="button" class="button" data-action="demo">Демо-режим без ИИ</button>
      </div>
    </section>

    <section class="setup__section">
      <div class="setup__section-head">
        <h2>2 · База данных SQLite</h2>
        <span class="badge" data-bind="db-badge" data-tone="neutral">файл не выбран</span>
      </div>
      <p class="setup__note" data-bind="db-note">
        Мне нужно место для визуализаций. Выберите файл базы на компьютере —
        я могу создать новый или открыть уже существующий.
      </p>
      <div class="setup__row">
        <button type="button" class="button button--primary" data-action="create-db">
          Создать новую базу
        </button>
        <button type="button" class="button" data-action="open-db">Открыть существующую</button>
        <button type="button" class="button" data-action="resume-db" hidden>Продолжить</button>
        <button type="button" class="button button--ghost" data-action="idb-db" hidden>
          Хранить в браузере
        </button>
      </div>
    </section>

    <footer class="setup__footer">
      <p class="setup__error" data-bind="error" hidden></p>
      <button type="button" class="button button--enter" data-action="enter" disabled>
        Войти в мир →
      </button>
    </footer>
  </div>
`;

/**
 * Стартовый диалог: проверка Gemini Nano (с загрузкой модели) и выбор файла
 * базы данных. Пока диалог открыт, мир служит просто фоном.
 */
export class SetupDialog {
  private readonly root: HTMLElement;
  private readonly modelBadge: HTMLElement;
  private readonly modelNote: HTMLElement;
  private readonly modelProgress: HTMLElement;
  private readonly modelProgressBar: HTMLElement;
  private readonly modelProgressLabel: HTMLElement;
  private readonly downloadButton: HTMLButtonElement;
  private readonly demoButton: HTMLButtonElement;
  private readonly dbBadge: HTMLElement;
  private readonly dbNote: HTMLElement;
  private readonly createButton: HTMLButtonElement;
  private readonly openButton: HTMLButtonElement;
  private readonly resumeButton: HTMLButtonElement;
  private readonly idbButton: HTMLButtonElement;
  private readonly enterButton: HTMLButtonElement;
  private readonly errorBox: HTMLElement;

  constructor(host: HTMLElement, private readonly handlers: SetupHandlers) {
    this.root = document.createElement('div');
    this.root.className = 'modal';
    this.root.hidden = true;
    this.root.innerHTML = TEMPLATE;
    host.appendChild(this.root);

    this.modelBadge = requireElement(this.root, '[data-bind="model-badge"]');
    this.modelNote = requireElement(this.root, '[data-bind="model-note"]');
    this.modelProgress = requireElement(this.root, '[data-bind="model-progress"]');
    this.modelProgressBar = requireElement(this.root, '[data-bind="model-progress"] .progress__bar');
    this.modelProgressLabel = requireElement(
      this.root,
      '[data-bind="model-progress"] .progress__label',
    );
    this.downloadButton = requireElement<HTMLButtonElement>(this.root, '[data-action="download"]');
    this.demoButton = requireElement<HTMLButtonElement>(this.root, '[data-action="demo"]');
    this.dbBadge = requireElement(this.root, '[data-bind="db-badge"]');
    this.dbNote = requireElement(this.root, '[data-bind="db-note"]');
    this.createButton = requireElement<HTMLButtonElement>(this.root, '[data-action="create-db"]');
    this.openButton = requireElement<HTMLButtonElement>(this.root, '[data-action="open-db"]');
    this.resumeButton = requireElement<HTMLButtonElement>(this.root, '[data-action="resume-db"]');
    this.idbButton = requireElement<HTMLButtonElement>(this.root, '[data-action="idb-db"]');
    this.enterButton = requireElement<HTMLButtonElement>(this.root, '[data-action="enter"]');
    this.errorBox = requireElement(this.root, '[data-bind="error"]');

    this.root.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
      switch (target?.dataset.action) {
        case 'download':
          this.handlers.onDownloadModel();
          break;
        case 'demo':
          this.handlers.onUseDemo();
          break;
        case 'create-db':
          this.handlers.onCreateDatabase();
          break;
        case 'open-db':
          this.handlers.onOpenDatabase();
          break;
        case 'resume-db':
          this.handlers.onResumeDatabase();
          break;
        case 'idb-db':
          this.handlers.onCreateIdbDatabase();
          break;
        case 'enter':
          this.handlers.onEnter();
          break;
        default:
          break;
      }
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  setModelState(state: ModelState): void {
    this.modelBadge.textContent = state.badge;
    this.modelBadge.dataset.tone = state.tone;
    this.modelNote.innerHTML = state.note;

    this.downloadButton.hidden = !state.downloadVisible;
    this.downloadButton.textContent = state.downloadLabel;
    this.downloadButton.disabled = state.downloadDisabled === true;

    this.demoButton.hidden = !state.demoVisible;
    if (state.demoLabel) this.demoButton.textContent = state.demoLabel;

    if (state.progress === null) {
      this.modelProgress.hidden = true;
    } else {
      this.modelProgress.hidden = false;
      const percent = Math.round(Math.max(0, Math.min(1, state.progress)) * 100);
      this.modelProgressBar.style.width = `${percent}%`;
      this.modelProgressLabel.textContent = `${percent}%`;
    }
  }

  setDbState(state: DbState): void {
    this.dbBadge.textContent = state.badge;
    this.dbBadge.dataset.tone = state.tone;
    this.dbNote.innerHTML = state.note;

    this.createButton.textContent = state.createLabel;
    this.createButton.disabled = state.createDisabled === true;
    this.openButton.textContent = state.openLabel;
    this.openButton.disabled = state.openDisabled === true;

    this.resumeButton.hidden = !state.resumeLabel;
    if (state.resumeLabel) this.resumeButton.textContent = state.resumeLabel;

    this.idbButton.hidden = !state.idbLabel;
    if (state.idbLabel) this.idbButton.textContent = state.idbLabel;
  }

  setCanEnter(canEnter: boolean): void {
    this.enterButton.disabled = !canEnter;
  }

  setError(message: string | null): void {
    this.errorBox.hidden = !message;
    this.errorBox.textContent = message ?? '';
  }

  setBusy(action: 'download' | 'db', busy: boolean): void {
    if (action === 'download') {
      this.downloadButton.disabled = busy;
      this.demoButton.disabled = busy;
    } else {
      this.createButton.disabled = busy;
      this.openButton.disabled = busy;
      this.resumeButton.disabled = busy;
      this.idbButton.disabled = busy;
    }
  }
}
