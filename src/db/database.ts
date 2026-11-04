import initSqlite3, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import sqlite3WasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import type { Visualization, VisualizationSpec } from '../types';
import type { DbStorage } from './storage';

/**
 * Хранилище визуализаций на SQLite (WASM).
 *
 * База живёт в памяти, а «файл» — это байты, которые мы читаем при открытии и
 * записываем обратно после каждого изменения (дебаунс). Так пользователь
 * получает настоящий .sqlite-файл на своём диске, а приложение — быстрый доступ.
 */

const SQLITE_MAGIC = 'SQLite format 3\u0000';
const SAVE_DEBOUNCE_MS = 350;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS visualizations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  spec TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'nano',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visualizations_created_at ON visualizations (created_at DESC);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let sqlite3Promise: Promise<Sqlite3Static> | null = null;

function loadSqlite3(): Promise<Sqlite3Static> {
  if (!sqlite3Promise) {
    const init = initSqlite3 as unknown as (
      config: Record<string, unknown>,
    ) => Promise<Sqlite3Static>;
    sqlite3Promise = init({
      locateFile: () => sqlite3WasmUrl,
      print: (text: string) => console.debug('[sqlite]', text),
      printErr: (text: string) => console.warn('[sqlite]', text),
    }).catch((error: unknown) => {
      sqlite3Promise = null;
      throw error;
    });
  }
  return sqlite3Promise;
}

function looksLikeSqlite(bytes: Uint8Array): boolean {
  if (bytes.byteLength < SQLITE_MAGIC.length) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) {
    if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

function isVisualization(value: unknown): value is Visualization {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.spec === 'object' && record.spec !== null;
}

export interface OpenResult {
  /** База была создана с нуля (файл был пустым). */
  created: boolean;
  /** Сколько визуализаций уже в базе. */
  count: number;
}

interface VisualizationRow {
  id: string;
  title: string;
  description: string;
  prompt: string;
  spec: string;
  source: string;
  created_at: number;
}

export class VizDatabase {
  private sqlite3: Sqlite3Static | null = null;
  private db: Database | null = null;
  private storage: DbStorage | null = null;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  get isOpen(): boolean {
    return this.db !== null;
  }

  get locationLabel(): string {
    return this.storage?.label ?? '—';
  }

  get storageKind(): DbStorage['kind'] | null {
    return this.storage?.kind ?? null;
  }

  async open(storage: DbStorage): Promise<OpenResult> {
    await this.close();
    const sqlite3 = await loadSqlite3();
    const bytes = await storage.read();
    const created = !bytes || bytes.byteLength === 0;

    let db: Database;
    if (!created && bytes) {
      if (!looksLikeSqlite(bytes)) {
        throw new Error(`Файл «${storage.label}» не является базой SQLite`);
      }
      db = new sqlite3.oo1.DB({ filename: ':memory:' });
      const dataPtr = sqlite3.wasm.allocFromTypedArray(bytes);
      const flags =
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
      const rc = sqlite3.capi.sqlite3_deserialize(
        db,
        'main',
        dataPtr,
        bytes.byteLength,
        bytes.byteLength,
        flags,
      );
      if (rc !== sqlite3.capi.SQLITE_OK) {
        db.close();
        throw new Error(`SQLite не смогла прочитать файл (код ${rc})`);
      }
    } else {
      db = new sqlite3.oo1.DB({ filename: ':memory:', flags: 'c' });
    }

    db.exec(SCHEMA);

    this.sqlite3 = sqlite3;
    this.db = db;
    this.storage = storage;

    const count = this.count();
    if (created) await this.saveNow();
    return { created, count };
  }

  list(): Visualization[] {
    const db = this.db;
    if (!db) return [];
    const rows = db.selectObjects(
      'SELECT id, title, description, prompt, spec, source, created_at FROM visualizations ORDER BY created_at DESC',
    ) as unknown as VisualizationRow[];

    const result: Visualization[] = [];
    for (const row of rows) {
      try {
        const spec = JSON.parse(row.spec) as VisualizationSpec;
        const candidate = {
          id: row.id,
          title: row.title,
          description: row.description,
          prompt: row.prompt,
          spec,
          createdAt: Number(row.created_at),
          source: row.source === 'demo' ? 'demo' : 'nano',
        } satisfies Visualization;
        if (isVisualization(candidate)) result.push(candidate);
      } catch {
        console.warn('[visual-lab] пропускаю повреждённую запись', row.id);
      }
    }
    return result;
  }

  count(): number {
    const db = this.db;
    if (!db) return 0;
    const value = db.selectValue('SELECT COUNT(*) FROM visualizations');
    return typeof value === 'number' ? value : Number(value ?? 0);
  }

  insert(viz: Visualization): void {
    const db = this.requireDb();
    db.exec({
      sql: `INSERT OR REPLACE INTO visualizations
              (id, title, description, prompt, spec, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      bind: [
        viz.id,
        viz.title,
        viz.description,
        viz.prompt,
        JSON.stringify(viz.spec),
        viz.source,
        viz.createdAt,
      ],
    });
    this.scheduleSave();
  }

  remove(id: string): void {
    const db = this.requireDb();
    db.exec({ sql: 'DELETE FROM visualizations WHERE id = ?', bind: [id] });
    this.scheduleSave();
  }

  addMessage(role: 'user' | 'conductor', content: string): void {
    const db = this.db;
    if (!db) return;
    db.exec({
      sql: 'INSERT INTO messages (role, content, created_at) VALUES (?, ?, ?)',
      bind: [role, content, Date.now()],
    });
    this.scheduleSave();
  }

  messageCount(): number {
    const db = this.db;
    if (!db) return 0;
    const value = db.selectValue('SELECT COUNT(*) FROM messages');
    return typeof value === 'number' ? value : Number(value ?? 0);
  }

  /** Планирует запись байтов в файл (дебаунс, чтобы не писать на каждый чих). */
  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow().catch((error: unknown) => {
        console.error('[visual-lab] не удалось сохранить базу', error);
      });
    }, SAVE_DEBOUNCE_MS);
  }

  /** Немедленно сериализует базу и пишет её в файл. */
  async saveNow(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const db = this.db;
    const storage = this.storage;
    const sqlite3 = this.sqlite3;
    if (!db || !storage || !sqlite3) return;

    const bytes = sqlite3.capi.sqlite3_js_db_export(db);
    this.writeChain = this.writeChain
      .catch(() => {
        /* предыдущая ошибка записи не должна блокировать очередь */
      })
      .then(async () => {
        // пока ждали очередь, базу могли переоткрыть — тогда писать некуда
        if (this.storage !== storage || this.db !== db) return;
        await storage.write(bytes);
      });

    await this.writeChain;
  }

  private requireDb(): Database {
    if (!this.db) throw new Error('база данных не открыта');
    return this.db;
  }

  async close(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.writeChain.catch(() => {
      /* игнорируем ошибки записи при закрытии */
    });
    this.db?.close();
    this.db = null;
    this.storage = null;
  }
}
