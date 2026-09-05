/**
 * A boolean the person using the studio sets, remembered per browser.
 *
 * Not project state: it is a way of working, so it belongs to whoever is
 * sitting there rather than to the file they happen to have open. That rules
 * out putting it in the project payload, and `localStorage` is where the
 * palette already keeps the same kind of thing.
 *
 * Built as an external store rather than `useState` plus an effect for one
 * reason: this component renders on the server too, where `localStorage` does
 * not exist. Reading it in an effect means the first paint always shows the
 * default and then corrects itself, which React now flags as a cascading
 * render -- and reading it in a lazy initialiser means the server renders one
 * value and the browser hydrates with another. `useSyncExternalStore` is the
 * one shape that answers both: a server snapshot that is always the fallback,
 * and a client snapshot read straight from storage.
 */

export interface BooleanPreference {
  subscribe: (onChange: () => void) => () => void;
  get: () => boolean;
  getServerSnapshot: () => boolean;
  set: (value: boolean) => void;
}

export function createBooleanPreference(key: string, fallback: boolean): BooleanPreference {
  const listeners = new Set<() => void>();
  // Cached because `useSyncExternalStore` calls the snapshot on every render
  // and compares by identity; re-reading storage each time is both wasteful
  // and, if storage throws, inconsistent between calls.
  let cached: boolean | null = null;

  const read = (): boolean => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : raw === '1';
    } catch {
      // Private mode, disabled storage, or a sandboxed frame. A preference is
      // not worth failing a render over.
      return fallback;
    }
  };

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      // Another tab is the same person with the same preference.
      const onStorage = (event: StorageEvent) => {
        if (event.key === key) {
          cached = null;
          onChange();
        }
      };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener('storage', onStorage);
      };
    },
    get() {
      if (cached === null) cached = read();
      return cached;
    },
    getServerSnapshot() {
      return fallback;
    },
    set(value) {
      cached = value;
      try {
        localStorage.setItem(key, value ? '1' : '0');
      } catch {
        // Kept in memory for this session even when it cannot be persisted.
      }
      listeners.forEach(listener => listener());
    },
  };
}
