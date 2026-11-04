/**
 * Крошечная обёртка над IndexedDB (key-value).
 *
 * Используется для двух вещей:
 *  1. запомнить `FileSystemFileHandle` выбранного файла базы, чтобы при
 *     следующем запуске предложить продолжить работу с ним;
 *  2. резервное хранилище базы, если File System Access API недоступен
 *     (Firefox/Safari): тогда SQLite-файл лежит прямо в IndexedDB.
 */

const DB_NAME = 'visual-lab';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB недоступна'));
  });
}

function getDatabase(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabase().catch((error: unknown) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await getDatabase();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error('не удалось прочитать IndexedDB'));
  });
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await getDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('не удалось записать в IndexedDB'));
    tx.onabort = () => reject(tx.error ?? new Error('запись в IndexedDB прервана'));
  });
}

export async function kvDelete(key: string): Promise<void> {
  const db = await getDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('не удалось удалить запись из IndexedDB'));
  });
}
