/**
 * Word timings for the built-in reciters, from QUL's recitation exports.
 *
 * The studio's other source is quran.com's qdc API, which has segmented only
 * some of these reciters. The Quranic Universal Library (qul.tarteel.ai)
 * publishes surah-by-surah recitations "with segments" for five of the six --
 * Sudais (resource 407), Maher al-Muaiqly (405), Yasser ad-Dussary (422), Saud
 * ash-Shuraym (317) and Saad al-Ghamdi (335); none for Raad al-Kurdi -- as a
 * download rather than an API. The README lists which entry is which.
 *
 * **The timings belong to QUL's recording, not to the studio's.** The studio
 * plays these reciters from mp3quran.net, and a start time measured on one
 * file is fiction against another. So a QUL export is used with its own audio,
 * which the export names, and never mixed with the mp3quran file.
 *
 * Layout, one folder per studio reciter id, holding the JSON export unzipped
 * as QUL packs it:
 *
 *   data/qul/recitations/<reciter id>/…/surah.json      { "1": { "surah_number": 1, "audio_url": "…", "duration": … } }
 *   data/qul/recitations/<reciter id>/…/segments.json   { "1:1": { "segments": [[1, 361, 1051], …], "timestamp_from": 361, "timestamp_to": 4585 } }
 *
 * The shapes are the ones QUL's exporter writes (`Exporter::ExportSurahRecitation`
 * in its open-source repository). `segments` is `[word, start ms, end ms]`,
 * one-based over the ayah's words -- the same convention as quran.com, which
 * is why `reciterSegments` can build the timeline from either.
 *
 * Server side only: it reads the disk. `data/` is not in the repository, so a
 * fresh clone has no exports and every reciter reports none.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { RECITERS } from './quranData';
import type { ReciterVerseTiming } from './reciterSegments';

const ROOT = () => path.join(process.cwd(), 'data', 'qul', 'recitations');

interface Export {
  /** Surah number -> the export's audio for it. */
  audio: Map<number, string>;
  timings: Map<string, ReciterVerseTiming>;
}

/** Read once per process; `null` is cached too, for a reciter with no export. */
const cache = new Map<string, Export | null>();

/** Whether `file` exists and is a regular file; a missing one is simply false. */
function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The folders directly inside `dir`, or none when it does not exist. */
function foldersIn(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

/**
 * The file named `name` in `dir` or one level of folders below it.
 *
 * One level because that is how an unzipped export arrives: either the two
 * files directly, or inside the folder the zip was made from.
 */
function find(dir: string, name: string): string | null {
  return [dir, ...foldersIn(dir)].map(folder => path.join(folder, name)).find(isFile) ?? null;
}

function readJson(file: string | null): Record<string, unknown> | null {
  if (!file) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** An audio address the player may be pointed at: http(s) only. */
function audioAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The timing of one ayah as the export writes it, or null when it has none. */
function timingOf(entry: unknown): ReciterVerseTiming | null {
  const item = entry as { timestamp_from?: unknown; timestamp_to?: unknown; segments?: unknown } | null;
  const from = Number(item?.timestamp_from);
  const to = Number(item?.timestamp_to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const segments = Array.isArray(item?.segments)
    ? (item.segments as unknown[]).filter(
        (segment): segment is number[] =>
          Array.isArray(segment) && segment.length >= 3 && segment.slice(0, 3).every(n => Number.isFinite(n))
      )
    : undefined;
  return { from, to, segments: segments?.length ? segments : undefined };
}

/** Parses one reciter's export, or null when it is absent or unreadable. */
export function parseExport(surahs: Record<string, unknown> | null, segments: Record<string, unknown> | null): Export | null {
  if (!surahs || !segments) return null;

  const audio = new Map<number, string>();
  for (const [key, value] of Object.entries(surahs)) {
    const row = value as { surah_number?: unknown; audio_url?: unknown } | null;
    const surah = Number(row?.surah_number ?? key);
    const url = audioAddress(row?.audio_url);
    if (Number.isInteger(surah) && surah >= 1 && surah <= 114 && url) audio.set(surah, url);
  }

  const timings = new Map<string, ReciterVerseTiming>();
  for (const [verseKey, value] of Object.entries(segments)) {
    if (!/^\d+:\d+$/.test(verseKey)) continue;
    const timing = timingOf(value);
    if (timing) timings.set(verseKey, timing);
  }

  return audio.size && timings.size ? { audio, timings } : null;
}

function load(reciterId: string): Export | null {
  if (cache.has(reciterId)) return cache.get(reciterId) ?? null;
  // Only a studio reciter's id is ever joined onto the path.
  const known = RECITERS.some(reciter => reciter.id === reciterId);
  const dir = path.join(ROOT(), reciterId);
  const parsed = known ? parseExport(readJson(find(dir, 'surah.json')), readJson(find(dir, 'segments.json'))) : null;
  cache.set(reciterId, parsed);
  return parsed;
}

/** The studio reciters with a QUL export on this machine. */
export function qulReciters(): string[] {
  return RECITERS.map(reciter => reciter.id).filter(id => load(id) !== null);
}

/**
 * One surah of a reciter's export: the audio QUL timed, and the timing of
 * every ayah in it. Null when this reciter or this surah is not held.
 */
export function qulSurah(
  reciterId: string,
  surah: number
): { audioUrl: string; timings: Map<string, ReciterVerseTiming>; lastMs: number } | null {
  const held = load(reciterId);
  const audioUrl = held?.audio.get(surah);
  if (!held || !audioUrl) return null;

  const prefix = `${surah}:`;
  const timings = new Map<string, ReciterVerseTiming>();
  let lastMs = 0;
  for (const [verseKey, timing] of held.timings) {
    if (!verseKey.startsWith(prefix)) continue;
    timings.set(verseKey, timing);
    lastMs = Math.max(lastMs, timing.to);
  }
  return timings.size ? { audioUrl, timings, lastMs } : null;
}
