/**
 * The studio's one IndexedDB database, and the only place its version lives.
 *
 * Two things need real binary storage in the browser: uploaded backgrounds,
 * which have been kept here since they were added, and the audio a saved
 * project was built from. They share a database because they must share a
 * *version* -- two modules opening `quranclipper` at different versions is not
 * a merge, it is one of them getting `onblocked` and silently falling back to
 * "storage unavailable". So the stores are declared together here and opened
 * through one function.
 *
 * Nothing in this module throws. Private windows, disabled storage and quota
 * limits are all ordinary conditions, and every one of them degrades to "this
 * did not persist" rather than breaking the feature that asked.
 */

const DB_NAME = 'quranclipper';

/**
 * Bumped from 1 when `audio` was added.
 *
 * Raising this runs `onupgradeneeded` against an existing database, where each
 * store is created only if it is missing -- so an upgrade from 1 keeps every
 * background already stored.
 */
const DB_VERSION = 2;

export type StoreName = 'backgrounds' | 'audio';

const STORES: StoreName[] = ['backgrounds', 'audio'];

export function openDb(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      for (const store of STORES) {
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

/** False when the write did not land -- most often quota, on files this size. */
export function idbPut(store: StoreName, key: string, value: Blob): Promise<boolean> {
  return openDb().then(db => {
    if (!db) return false;
    return new Promise<boolean>(resolve => {
      try {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  });
}

export function idbGet(store: StoreName, key: string): Promise<Blob | null> {
  return openDb().then(db => {
    if (!db) return null;
    return new Promise<Blob | null>(resolve => {
      try {
        const request = db.transaction(store, 'readonly').objectStore(store).get(key);
        request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

export function idbDelete(store: StoreName, key: string): Promise<void> {
  return openDb().then(db => {
    if (!db) return;
    try {
      db.transaction(store, 'readwrite').objectStore(store).delete(key);
    } catch {
      // Nothing to do: the record is unreachable either way.
    }
  });
}
