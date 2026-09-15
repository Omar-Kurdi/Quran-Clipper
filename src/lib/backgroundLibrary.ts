import { MediaKind, rememberMediaKind, rememberMediaName, STORED_BACKGROUND_PREFIX } from './backgroundTimeline';
import { idbPut, idbGet, idbDelete } from './idb';

/**
 * The backgrounds a user has added themselves.
 *
 * A pasted link is a string and survives in `localStorage` on its own. An
 * upload is not: `URL.createObjectURL` hands back a `blob:` url that is only
 * valid for the page that made it, so saving that string saved a pointer to
 * something already gone -- the list came back after a restart with the
 * uploads silently missing. The files themselves therefore live in IndexedDB,
 * which holds real binary at video sizes, and a fresh object url is minted for
 * each one at startup.
 *
 * An entry whose file cannot be found again is *kept*, with no url. Dropping it
 * would delete a choice the user made because of a storage failure they never
 * saw; showing it as a placeholder says what happened and offers the only two
 * useful actions -- add it again, or remove it.
 */
export interface LibraryItem {
  id: string;
  kind: MediaKind;
  label: string;
  /** Where the media comes from: a link that can be fetched again, or a stored file. */
  source: 'link' | 'upload';
  /** Usable for this session. Null when an upload's file could not be found. */
  url: string | null;
}

/** What goes to `localStorage`: everything but the per-session object url. */
type StoredItem = { id: string; kind: MediaKind; label: string; source: 'link' | 'upload'; url?: string };

const LIST_KEY = 'qc-background-library';

const EMPTY: LibraryItem[] = [];

const put = (id: string, blob: Blob) => idbPut('backgrounds', id, blob);
const get = (id: string) => idbGet('backgrounds', id);
const drop = (id: string) => idbDelete('backgrounds', id);

// ---------------------------------------------------------------------------
// The list itself
// ---------------------------------------------------------------------------

function readStored(): StoredItem[] {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    const saved = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(saved)) return [];
    return saved
      .filter(item => item && typeof item.label === 'string')
      .map<StoredItem>((item, index) => ({
        // Records written before uploads were storable have no id or source.
        id: typeof item.id === 'string' ? item.id : `bg_${index}_${item.url ?? index}`,
        kind: item.kind === 'image' ? ('image' as MediaKind) : ('video' as MediaKind),
        label: item.label,
        source: item.source === 'upload' ? ('upload' as const) : ('link' as const),
        url: typeof item.url === 'string' ? item.url : undefined
      }))
      .filter(item => item.source === 'upload' || Boolean(item.url));
  } catch {
    return [];
  }
}

function writeStored(list: LibraryItem[]): void {
  try {
    localStorage.setItem(
      LIST_KEY,
      JSON.stringify(
        list.map<StoredItem>(item => ({
          id: item.id,
          kind: item.kind,
          label: item.label,
          source: item.source,
          // An upload's url is this session's only; the file in IndexedDB is
          // what actually persists.
          ...(item.source === 'link' && item.url ? { url: item.url } : {})
        }))
      )
    );
  } catch {
    // The list still works for this session.
  }
}

let items: LibraryItem[] = EMPTY;
let hydrating: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: LibraryItem[]): void {
  items = next;
  writeStored(next);
  listeners.forEach(listener => listener());
}

export function subscribeToLibrary(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Stable between changes, as `useSyncExternalStore` requires. */
export function librarySnapshot(): LibraryItem[] {
  return items;
}

/** The server renders an empty list, so the first paint matches the markup. */
export function serverLibrarySnapshot(): LibraryItem[] {
  return EMPTY;
}

/**
 * Reads the list back, minting a fresh object url per stored upload.
 *
 * Runs once. Nothing here rejects: a file that cannot be found leaves its entry
 * with a null url, which the panel draws as a placeholder.
 */
export function hydrateLibrary(): Promise<void> {
  if (hydrating) return hydrating;
  const attempt = (async () => {
    const stored = readStored();
    if (stored.length === 0) return;
    const restored: LibraryItem[] = [];
    for (const item of stored) {
      if (item.source === 'link') {
        restored.push({ ...item, url: item.url ?? null, source: 'link' });
        continue;
      }
      const blob = await get(item.id);
      restored.push({ ...item, source: 'upload', url: blob ? URL.createObjectURL(blob) : null });
    }
    restored.forEach(item => {
      if (!item.url) return;
      rememberMediaKind(item.url, item.kind);
      // A fresh object url each session, so the name has to be re-registered
      // with it -- otherwise a restored upload goes back to "Uploaded clip".
      rememberMediaName(item.url, item.label);
    });
    items = restored;
    listeners.forEach(listener => listener());
  })();
  // A database that would not open -- another tab mid-upgrade, storage briefly
  // unavailable -- must not empty the list for the rest of the session. If the
  // attempt restored nothing while records exist, the next mount tries again.
  hydrating = attempt.then(() => {
    if (items.length === 0 && readStored().length > 0) hydrating = null;
  });
  return hydrating;
}

const newId = () => `bg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Stores an uploaded file and adds it to the list.
 *
 * `stored` is false when IndexedDB refused it -- out of quota, or unavailable.
 * The background still works for this session; it simply will not come back,
 * and the caller says so rather than letting it vanish without explanation.
 */
export async function addLibraryUpload(
  file: File,
  kind: MediaKind
): Promise<{ item: LibraryItem; stored: boolean }> {
  const id = newId();
  const url = URL.createObjectURL(file);
  rememberMediaKind(url, kind);
  rememberMediaName(url, file.name);
  const stored = await put(id, file);
  const item: LibraryItem = { id, kind, label: file.name, source: 'upload', url };
  publish([...items, item]);
  return { item, stored };
}

/** Adds a pasted link, or returns the existing entry if it is already listed. */
export function addLibraryLink(url: string, kind: MediaKind, label: string): LibraryItem {
  rememberMediaKind(url, kind);
  rememberMediaName(url, label);
  const existing = items.find(item => item.url === url);
  if (existing) return existing;
  const item: LibraryItem = { id: newId(), kind, label, source: 'link', url };
  publish([...items, item]);
  return item;
}

/** Drops an entry, its stored file, and its object url. */
export async function removeLibraryItem(id: string): Promise<void> {
  const item = items.find(entry => entry.id === id);
  publish(items.filter(entry => entry.id !== id));
  if (!item) return;
  if (item.source === 'upload') {
    if (item.url) URL.revokeObjectURL(item.url);
    await drop(id);
  }
}

// ---------------------------------------------------------------------------
// Referring to a stored upload from outside this session
//
// The list above survives a restart, but the object urls in it do not: each
// upload gets a fresh one every time `hydrateLibrary` runs. Anything that
// outlives the tab -- a saved project -- therefore cannot hold the url. It
// holds the library's own id for the file, and asks for a url when it is read
// back. This is the same trade the recitation makes with `audioKey`.
// ---------------------------------------------------------------------------

/** The durable form of one background url: an upload's id, or the url as given. */
export function storedBackgroundUrl(url: string, list: LibraryItem[] = items): string {
  if (!url || !url.startsWith('blob:')) return url;
  const item = list.find(entry => entry.source === 'upload' && entry.url === url);
  return item ? `${STORED_BACKGROUND_PREFIX}${item.id}` : url;
}

/**
 * The playable form of one background url.
 *
 * A reference whose file is gone comes back unchanged rather than as the
 * default background. The canvas draws its gradient through a url it cannot
 * load, which is the same thing it does for a link that has stopped working --
 * and the reference is still in the project, so re-adding the file restores
 * it. Substituting a default would look like a repair while quietly replacing
 * a choice the user made, and the next save would make that permanent.
 */
export function restoredBackgroundUrl(url: string, list: LibraryItem[] = items): string {
  if (!url || !url.startsWith(STORED_BACKGROUND_PREFIX)) return url;
  const item = list.find(entry => entry.id === url.slice(STORED_BACKGROUND_PREFIX.length));
  return item?.url || url;
}

/** The three places a styling config keeps a background url. */
type BackgroundUrls = {
  bgUrl?: string;
  bgUrls?: string[];
  bgSegments?: { url: string; start: number; end: number }[];
};

function mapBackgroundUrls<C extends BackgroundUrls>(config: C, map: (url: string) => string): C {
  return {
    ...config,
    ...(typeof config.bgUrl === 'string' ? { bgUrl: map(config.bgUrl) } : {}),
    ...(Array.isArray(config.bgUrls) ? { bgUrls: config.bgUrls.map(url => map(url)) } : {}),
    // Never filtered, only rewritten: dropping a segment whose file is missing
    // would shift what every segment after it covers.
    ...(Array.isArray(config.bgSegments)
      ? { bgSegments: config.bgSegments.map(segment => ({ ...segment, url: map(segment.url) })) }
      : {})
  };
}

/** A config as it should be written out: uploads by id, everything else as-is. */
export function withStoredBackgrounds<C extends BackgroundUrls>(
  config: C, list: LibraryItem[] = items
): C {
  return mapBackgroundUrls(config, url => storedBackgroundUrl(url, list));
}

/** A config as it should be used: ids turned back into this session's urls. */
export function withRestoredBackgrounds<C extends BackgroundUrls>(
  config: C, list: LibraryItem[] = items
): C {
  return mapBackgroundUrls(config, url => restoredBackgroundUrl(url, list));
}
