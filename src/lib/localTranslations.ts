/**
 * Translation editions installed on this machine rather than fetched.
 *
 * The upstream serves most editions, but an installation may hold others of
 * its own: one JSON file per edition under `data/local-translations/`, listed
 * in a `manifest.json` beside them. None ship with the repository -- `data/`
 * is ignored -- so a fresh clone has none, and every caller treats "none" as
 * "ask the upstream as usual".
 *
 *   manifest.json   [{ "id": "…", "name": "…", "language": "English", "file": "….json" }]
 *   <file>          { "1": ["ayah 1", "ayah 2", …], "2": [...], … }
 *
 * The text is stored exactly as it should be drawn. Anything an edition needs
 * repaired is done by whatever installed it, once, rather than here on every
 * read -- this module only reads.
 *
 * The id is the upstream's resource id for the same edition where it has one,
 * so a project that names it means the same text wherever it is opened.
 *
 * Server side only. `quranApi` and `quranCorpus` are reachable from the client
 * bundle, and this reads the disk.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface LocalEdition {
  id: string;
  name: string;
  language: string;
}

interface ManifestEntry extends LocalEdition {
  file: string;
}

const DIR = () => path.join(process.cwd(), 'data', 'local-translations');

/**
 * Read once per process. `null` is cached as well: an edition that is not
 * installed will still not be installed on the next request.
 */
let manifest: ManifestEntry[] | undefined;
const texts = new Map<string, Record<string, string[]> | null>();

function readManifest(): ManifestEntry[] {
  if (manifest !== undefined) return manifest;
  try {
    const parsed = JSON.parse(readFileSync(path.join(DIR(), 'manifest.json'), 'utf8'));
    manifest = (Array.isArray(parsed) ? parsed : [])
      .filter(
        (entry): entry is ManifestEntry =>
          typeof entry?.id === 'string' && /^\d+$/.test(entry.id) &&
          typeof entry.name === 'string' && typeof entry.file === 'string' &&
          // A file name, never a path: the manifest is local, but it is still
          // not a way to read anything outside this directory.
          path.basename(entry.file) === entry.file
      )
      .map(entry => ({ ...entry, language: entry.language || 'English' }));
  } catch {
    manifest = [];
  }
  return manifest;
}

function readEdition(id: string): Record<string, string[]> | null {
  if (texts.has(id)) return texts.get(id) ?? null;
  const entry = readManifest().find(item => item.id === id);
  let bySurah: Record<string, string[]> | null = null;
  if (entry) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(DIR(), entry.file), 'utf8'));
      if (parsed && typeof parsed === 'object') bySurah = parsed as Record<string, string[]>;
    } catch {
      bySurah = null;
    }
  }
  texts.set(id, bySurah);
  return bySurah;
}

/** The editions this machine holds, as the picker lists them. */
export function localEditions(): LocalEdition[] {
  return readManifest()
    .filter(entry => readEdition(entry.id) !== null)
    .map(({ id, name, language }) => ({ id, name, language }));
}

/** One surah of a local edition, ayah 1 first, or null when it is not held. */
export function localSurah(id: string, surah: number): string[] | null {
  const ayahs = readEdition(id)?.[String(surah)];
  return Array.isArray(ayahs) ? ayahs : null;
}

/** One ayah by its 1-based number, or `''` when it is not held. */
export function localAyah(id: string, surah: number, ayah: number): string {
  return localSurah(id, surah)?.[ayah - 1] ?? '';
}

/**
 * The translation one verse should show, with this machine filling the gap.
 *
 * Both server paths that build captions go through here, and they must: the
 * Load button reaches `/api/quran/verses`, while an AI match builds its
 * timeline from `quranCorpus`, and fixing only the first is what once left an
 * aligned timeline showing a different translation from the one the project
 * said it was showing.
 *
 * Order of preference is the order asked for, with a local copy directly
 * behind the id it stands for -- so the upstream still wins wherever it does
 * carry that edition, and the fallback is still reached when neither has it.
 *
 * `clean` is passed in rather than imported to keep this module free of
 * anything but `node:fs`: an import cycle through `quranApi` or `quranCorpus`
 * would drag the file reader towards the client bundle.
 */
export function primaryTranslation(input: {
  surah: number;
  ayah: number;
  translations: { resource_id?: number; text?: string }[] | undefined;
  wanted: string[];
  clean: (text: string) => string;
}): string {
  const list = input.translations || [];
  const textFor = (id: string) => list.find(entry => String(entry?.resource_id) === id && entry?.text)?.text;

  const primary = input.wanted[0];
  const carried = primary ? textFor(primary) : undefined;
  if (carried) return input.clean(carried);

  if (primary) {
    const local = localAyah(primary, input.surah, input.ayah);
    if (local) return local;
  }

  for (const id of input.wanted.slice(1)) {
    const found = textFor(id);
    if (found) return input.clean(found);
  }
  return input.clean(list.find(entry => entry?.text)?.text || '');
}
