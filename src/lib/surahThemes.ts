import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * The topic groups of a surah, from QUL's "Ayah theme" export imported by
 * `scripts/qul-themes.mjs` into this machine's data folder -- never the
 * checkout: QUL gives no licence for it, so it is not committed or shipped,
 * and a studio without it suggests clips by ruku instead.
 */
const themesFile = () => path.join(
  process.env.QC_QUL_DIR || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'quran-clipper', 'qul'),
  'ayah-themes.json',
);

let read: { at: number; bySurah: Record<string, [number, number, string][]> | null } | null = null;
/** How long a reading of the file is used before it is read again: an import shows within a minute. */
const KEEP_MS = 60_000;

/** The surah's groups, `[first, last, topic]` in order; null when this machine has none for it. */
export async function surahThemes(surah: number): Promise<[number, number, string][] | null> {
  if (!read || Date.now() - read.at > KEEP_MS) {
    const bySurah = await readFile(themesFile(), 'utf8').then(text => JSON.parse(text)).catch(() => null);
    read = { at: Date.now(), bySurah: bySurah && typeof bySurah === 'object' ? bySurah : null };
  }
  const groups = read.bySurah?.[String(surah)];
  return Array.isArray(groups) && groups.length ? groups : null;
}
