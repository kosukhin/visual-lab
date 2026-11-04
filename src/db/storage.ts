import { kvDelete, kvGet, kvSet } from './idb';

/**
 * Абстракция над «файлом базы»: настоящий файл на диске (File System Access
 * API) или запасной вариант — байты в IndexedDB.
 */

export type StorageKind = 'file' | 'idb';

export interface DbStorage {
  readonly kind: StorageKind;
  readonly label: string;
  /** Текущее содержимое файла базы (null, если файл пустой/новый). */
  read(): Promise<Uint8Array | null>;
  write(bytes: Uint8Array): Promise<void>;
}

const HANDLE_KEY = 'sqlite-file-handle';
const FALLBACK_BYTES_KEY = 'sqlite-fallback-bytes';
export const FALLBACK_DB_NAME = 'visual-lab.sqlite';

const PICKER_TYPES = [
  {
    description: 'База данных SQLite',
    accept: { 'application/x-sqlite3': ['.sqlite', '.sqlite3', '.db'] },
  },
];

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export class FileStorage implements DbStorage {
  readonly kind = 'file' as const;

  constructor(private readonly handle: FileSystemFileHandle) {}

  get label(): string {
    return this.handle.name;
  }

  async read(): Promise<Uint8Array | null> {
    const file = await this.handle.getFile();
    if (file.size === 0) return null;
    return new Uint8Array(await file.arrayBuffer());
  }

  async write(bytes: Uint8Array): Promise<void> {
    const writable = await this.handle.createWritable();
    // slice даёт «чистый» ArrayBuffer (Uint8Array<ArrayBufferLike> не проходит по типам FileSystemWriteChunkType)
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    await writable.write(buffer);
    await writable.close();
  }
}

export class IdbStorage implements DbStorage {
  readonly kind = 'idb' as const;
  readonly label = `IndexedDB · ${FALLBACK_DB_NAME}`;

  async read(): Promise<Uint8Array | null> {
    const stored = await kvGet<Uint8Array>(FALLBACK_BYTES_KEY);
    if (!stored || stored.byteLength === 0) return null;
    return stored instanceof Uint8Array ? stored : new Uint8Array(stored);
  }

  async write(bytes: Uint8Array): Promise<void> {
    await kvSet(FALLBACK_BYTES_KEY, bytes);
  }
}

/** Спрашивает у пользователя путь для новой базы. */
export async function pickNewDatabaseFile(): Promise<FileSystemFileHandle | null> {
  const picker = window.showSaveFilePicker;
  if (!picker) return null;
  try {
    const handle = await picker({
      suggestedName: FALLBACK_DB_NAME,
      types: PICKER_TYPES,
      id: 'visual-lab-db',
    });
    await rememberHandle(handle);
    return handle;
  } catch (error) {
    if (isAbortError(error)) return null;
    throw error;
  }
}

/** Даёт пользователю выбрать существующий файл базы. */
export async function pickExistingDatabaseFile(): Promise<FileSystemFileHandle | null> {
  const picker = window.showOpenFilePicker;
  if (!picker) return null;
  try {
    const [handle] = await picker({ types: PICKER_TYPES, multiple: false, id: 'visual-lab-db' });
    if (!handle) return null;
    await rememberHandle(handle);
    return handle;
  } catch (error) {
    if (isAbortError(error)) return null;
    throw error;
  }
}

export async function rememberHandle(handle: FileSystemFileHandle): Promise<void> {
  try {
    await kvSet(HANDLE_KEY, handle);
  } catch (error) {
    console.warn('[visual-lab] не удалось запомнить файл базы', error);
  }
}

export async function loadRememberedHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const handle = await kvGet<FileSystemFileHandle>(HANDLE_KEY);
    return handle && typeof handle === 'object' ? handle : null;
  } catch {
    return null;
  }
}

export async function forgetRememberedHandle(): Promise<void> {
  try {
    await kvDelete(HANDLE_KEY);
  } catch {
    /* не критично */
  }
}

export async function hasPermission(
  handle: FileSystemFileHandle,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<boolean> {
  const query = handle.queryPermission;
  if (typeof query !== 'function') return true;
  try {
    return (await query.call(handle, { mode })) === 'granted';
  } catch {
    return true;
  }
}

/** Требует пользовательского жеста: вызывать только из обработчика клика. */
export async function requestPermission(
  handle: FileSystemFileHandle,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<boolean> {
  if (await hasPermission(handle, mode)) return true;
  const request = handle.requestPermission;
  if (typeof request !== 'function') return false;
  try {
    return (await request.call(handle, { mode })) === 'granted';
  } catch {
    return false;
  }
}
