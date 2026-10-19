/**
 * The built-in reciters' recordings: the Quran Foundation's one file per ayah,
 * kept on this machine (`scripts/qf-reciters.mjs`, run by `./install.sh`).
 *
 * A passage is played as its ayah files laid end to end in one file, so each
 * ayah starts exactly where the one before it ends: its bounds are the files'
 * own lengths, nothing measured or estimated. Inside an ayah, QF's word
 * timings are offset by where the ayah starts, for the captions to split at
 * the reciter's pauses (`publishedPhrases`).
 *
 * Server only. A chapter not yet on disk is fetched on first use by the same
 * script, so a studio installed with --no-recordings still works, a little
 * slower the first time.
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { decodeEdit, encodeEdit, isEdited, keptSpans } from './audioEdit';
import { renderEdit } from './audioRender';
import { studioMode } from './studioMode';
import catalog from './qfReciters.json';
import type { ReciterVerseTiming } from './reciterSegments';

const execFileAsync = promisify(execFile);

export interface QfReciter {
  id: string;
  /** The Quran Foundation's recitation of one file per ayah. */
  qfId?: number;
  /** Or its chapter-only reciter, whose surah recordings `scripts/qf-reciters.mjs` cuts into ayah files. */
  chapterId?: number;
  name: string;
  arabicName: string;
  style: string;
}

export const QF_RECITERS: QfReciter[] = [...catalog.reciters, ...catalog.chapterReciters];

/**
 * Where the ayah files are: outside the checkout, because `next build` reads
 * everything inside it, and 25 GB of recordings there ran it out of memory
 * (2026-10-15). `QC_QF_AUDIO_DIR` moves it; `scripts/qf-reciters.mjs` uses the same.
 */
const audioDir = () => process.env.QC_QF_AUDIO_DIR ||
  path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'quran-clipper', 'qf-audio');
const passagesDir = () => path.join(audioDir(), 'passages');
/** Stitched passages kept for the next play, least recently used first out. */
const MAX_PASSAGE_BYTES = 4 * 1024 * 1024 * 1024;
const pad = (n: number) => String(n).padStart(3, '0');

interface ChapterAyah {
  ayah: number;
  file: string;
  /** The file's length as played, ms. */
  ms: number;
  /** QF's word timings within the file: [word number, start ms, end ms]. */
  segments: number[][];
}

export const qfReciter = (id: string): QfReciter | undefined => QF_RECITERS.find(reciter => reciter.id === id);

/** A reciter's folder of ayah files: its recitation id, or `c` and its chapter-reciter id (QF numbers the two apart). */
const folderOf = (reciter: QfReciter) => (reciter.chapterId ? `c${reciter.chapterId}` : String(reciter.qfId));

/** A surah of a chapter reciter that could not be cut ayah by ayah exactly, and so is not offered. */
export class QfSurahUnavailable extends Error {}

/**
 * A passage starting or ending where a chapter reciter's surah was cut at a
 * join nothing stands by (`unsure` in its chapter file): the ayahs either side
 * are offered together, but not one without the other.
 */
export class QfPassageEdgeUnsure extends QfSurahUnavailable {}

interface UnsureJoin { ayah: number; reasons: string[] }

const fetching = new Map<string, Promise<void>>();

const unavailable = (reciter: QfReciter, surah: number) =>
  `${reciter.name}'s surah ${surah} could not be cut ayah by ayah exactly, so it is not offered. Choose another reciter for it.`;

/**
 * One chapter's ayahs on disk, fetching it first when it is not there yet. A
 * chapter reciter's surah is cut by the aligner as well, which takes minutes
 * for a long one.
 */
async function chapter(reciter: QfReciter, surah: number): Promise<{ ayahs: ChapterAyah[]; words: QfPassage['words']; unsure: UnsureJoin[] }> {
  const folder = path.join(audioDir(), folderOf(reciter));
  const file = path.join(folder, `${pad(surah)}.json`);
  if (!existsSync(file)) {
    // A public studio never cuts on a visitor's request: a long surah would keep them waiting for half an
    // hour and the server's aligner busy. Its surahs are cut ahead of time (./cut_reciters) or not offered.
    if (reciter.chapterId && studioMode() === 'public') {
      throw new QfSurahUnavailable(existsSync(path.join(folder, `${pad(surah)}.rejected.json`))
        ? unavailable(reciter, surah)
        : `${reciter.name}'s surah ${surah} is not ready on this studio yet. Choose another reciter for it.`);
    }
    const key = `${reciter.id}:${surah}`;
    if (!fetching.has(key)) {
      fetching.set(key, execFileAsync(process.execPath, [
        path.join(process.cwd(), 'scripts', 'qf-reciters.mjs'), 'download', '--reciter', reciter.id, '--surah', String(surah), '--quiet',
      ], { timeout: (reciter.chapterId ? 90 : 15) * 60_000 }).then(() => undefined, () => undefined).finally(() => fetching.delete(key)));
    }
    await fetching.get(key);
    const rejected = path.join(folder, `${pad(surah)}.rejected.json`);
    if (!existsSync(file) && existsSync(rejected)) {
      throw new QfSurahUnavailable(unavailable(reciter, surah));
    }
    if (!existsSync(file)) throw new Error(`could not fetch surah ${surah} for this reciter from the Quran Foundation`);
  }
  const data = JSON.parse(readFileSync(file, 'utf8'));
  // A cut chapter says whose word timings it kept (scripts/qf-reciters.mjs, `writeAyahs`).
  const unsure = Array.isArray(data?.unsure) ? (data.unsure as UnsureJoin[]).filter(join => Number.isInteger(join?.ayah)) : [];
  return { ayahs: chapterAyahs(data, file), words: data?.timing === 'aligner' ? 'cut' : 'qf', unsure };
}

/** A chapter file's ayahs, checked: one written by another version of the download script is refused, not misread. */
function chapterAyahs(data: unknown, file: string): ChapterAyah[] {
  const ayahs = (data as { ayahs?: unknown } | null)?.ayahs;
  const valid = Array.isArray(ayahs) && ayahs.every(entry =>
    entry && typeof entry === 'object' && Number.isInteger(entry.ayah) && typeof entry.file === 'string' &&
    Number.isFinite(entry.ms) && Array.isArray(entry.segments));
  if (!valid) throw new Error(`${file} is not a chapter of ayah files`);
  return ayahs as ChapterAyah[];
}

export interface QfPassage {
  /** Each ayah's bounds in the stitched file, seconds, and its word timings there (ms, on the same clock). */
  ayahs: { verseKey: string; start: number; end: number; timing: ReciterVerseTiming }[];
  totalSeconds: number;
  files: string[];
  /** Whose word timings: the Foundation's, or the aligner's from cutting a chapter recording its timings did not fit. */
  words: 'qf' | 'cut';
}

/** The unsure join a passage would start or end at, if any: the one before its first ayah, or after its last. */
export const unsureEdge = (unsure: UnsureJoin[], start: number, end: number): UnsureJoin | undefined =>
  unsure.find(join => join.ayah === start) ?? unsure.find(join => join.ayah === end + 1);

const unsureMessage = (reciter: QfReciter, surah: number, edge: UnsureJoin, start: number, end: number) =>
  edge.ayah === start
    ? (start > 1
      ? `${reciter.name}'s ${surah}:${start} cannot start a passage yet: where it starts in the recording is not certain. Start at ${surah}:${start - 1}.`
      : `${reciter.name}'s ${surah}:1 cannot start a passage yet: where the opening ends in the recording is not certain. Choose another reciter for it.`)
    : `${reciter.name}'s ${surah}:${end} cannot end a passage yet: where it ends in the recording is not certain. End at ${surah}:${end + 1}.`;

/** Where each ayah of `start`-`end` lies in the passage's stitched file. */
export async function qfPassage(reciterId: string, surah: number, start: number, end: number): Promise<QfPassage | null> {
  const reciter = qfReciter(reciterId);
  if (!reciter) return null;
  const { ayahs: all, words, unsure } = await chapter(reciter, surah);
  const edge = unsureEdge(unsure, start, end);
  if (edge) throw new QfPassageEdgeUnsure(unsureMessage(reciter, surah, edge, start, end));
  const ayahs = all.filter(entry => entry.ayah >= start && entry.ayah <= end);
  if (ayahs.length !== end - start + 1) return null;
  let at = 0;
  const placed = ayahs.map(entry => {
    const from = at;
    at += entry.ms;
    return {
      verseKey: `${surah}:${entry.ayah}`,
      start: from / 1000,
      end: at / 1000,
      timing: {
        from: Math.round(from),
        to: Math.round(at),
        // Numbers, whatever the file holds: some recitations come as strings.
        segments: entry.segments.map(segment => segment.map(Number)).filter(segment => segment.every(Number.isFinite))
          .map(([word, s, e]) => [word, Math.round(from + s), Math.round(from + Math.min(e, entry.ms))]),
      },
    };
  });
  return {
    words,
    ayahs: placed,
    totalSeconds: at / 1000,
    files: ayahs.map(entry => path.join(audioDir(), folderOf(reciter), entry.file)),
  };
}

/** The address the studio plays a passage at. */
export function qfPassageUrl(reciterId: string, surah: number, start: number, end: number): string {
  return `/api/audio/ayahs?reciter=${encodeURIComponent(reciterId)}&surah=${surah}&start=${start}&end=${end}`;
}

/** The passage an address of `qfPassageUrl`'s names, from any origin; null for any other address. */
export function qfPassageOf(address: string): { reciterId: string; surah: number; start: number; end: number } | null {
  let url: URL;
  try {
    url = new URL(address, 'http://studio.invalid');
  } catch {
    return null;
  }
  if (url.pathname !== '/api/audio/ayahs') return null;
  const reciterId = url.searchParams.get('reciter') || '';
  const [surah, start, end] = ['surah', 'start', 'end'].map(name => Number(url.searchParams.get(name)));
  if (!qfReciter(reciterId) || ![surah, start, end].every(Number.isInteger) || surah < 1 || surah > 114 || start < 1 || end < start) return null;
  return { reciterId, surah, start, end };
}

const stitching = new Map<string, Promise<string>>();

/** The passage's ayah files laid end to end in one MP3, made once and kept. */
export async function qfPassageFile(reciterId: string, surah: number, start: number, end: number, ffmpeg: string): Promise<string | null> {
  const passage = await qfPassage(reciterId, surah, start, end);
  if (!passage) return null;
  const target = path.join(passagesDir(), `${reciterId}-${pad(surah)}-${start}-${end}.mp3`);
  if (existsSync(target)) {
    void utimes(target, new Date(), new Date()).catch(() => undefined);
    return target;
  }
  if (!stitching.has(target)) {
    stitching.set(target, stitch(passage.files, target, ffmpeg).finally(() => stitching.delete(target)));
  }
  return stitching.get(target)!;
}

/**
 * The passage with an `AudioEdit` applied (`encodeEdit`'s text), made once and
 * kept beside the passage it was made from.
 *
 * Named after that passage, so the Content Sync's clean-up -- which deletes a
 * changed surah's stitched passages by name -- takes these with them: an
 * edited copy is the Quran Foundation's audio as much as the passage is, and
 * is kept no longer than the files it came from. Null when the passage or the
 * edit is not one.
 */
export async function qfEditedFile(
  { reciterId, surah, start, end }: { reciterId: string; surah: number; start: number; end: number }, editText: string, ffmpeg: string
): Promise<string | null> {
  const edit = decodeEdit(editText);
  const passage = await qfPassage(reciterId, surah, start, end);
  if (!edit || !isEdited(edit) || !passage || !keptSpans(edit.cuts, passage.totalSeconds).length) return null;
  const source = await qfPassageFile(reciterId, surah, start, end, ffmpeg);
  if (!source) return null;
  const hash = createHash('sha1').update(encodeEdit(edit)).digest('hex').slice(0, 16);
  const target = path.join(passagesDir(), `${reciterId}-${pad(surah)}-${start}-${end}.e${hash}.flac`);
  if (existsSync(target)) {
    void utimes(target, new Date(), new Date()).catch(() => undefined);
    return target;
  }
  if (!stitching.has(target)) {
    const partial = `${target}.${process.pid}.part.flac`;
    stitching.set(target, renderEdit(ffmpeg, source, edit, passage.totalSeconds, partial)
      .then(() => rename(partial, target))
      .then(() => prune())
      .then(() => target)
      .finally(() => {
        stitching.delete(target);
        void rm(partial, { force: true });
      }));
  }
  return stitching.get(target)!;
}

async function stitch(files: string[], target: string, ffmpeg: string): Promise<string> {
  await mkdir(passagesDir(), { recursive: true });
  const list = `${target}.${process.pid}.txt`;
  const partial = `${target}.${process.pid}.part.mp3`;
  try {
    await writeFile(list, files.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join('\n'));
    // Frames copied as they are, not re-encoded: each ayah keeps the length
    // its bounds were counted from. And no Xing/LAME header: a player trims
    // the encoder padding it announces once from the whole file, which put
    // Al-Husary's 2:255-257 76ms short of its counted frames. Every recitation
    // is constant-bitrate (2026-10-15), so seeking needs no header.
    await execFileAsync(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0',
      '-i', list, '-map_metadata', '-1', '-c', 'copy', '-write_xing', '0', partial], { timeout: 10 * 60_000 });
    await rename(partial, target);
    await prune();
    return target;
  } finally {
    await rm(list, { force: true });
    await rm(partial, { force: true });
  }
}

async function prune(): Promise<void> {
  const names = (await readdir(passagesDir())).filter(name => /\.(mp3|flac)$/.test(name) && !name.includes('.part'));
  const files = await Promise.all(names.map(async name => {
    const file = path.join(passagesDir(), name);
    const { size, mtimeMs } = await stat(file);
    return { file, size, mtimeMs };
  }));
  let total = files.reduce((sum, file) => sum + file.size, 0);
  const evicted = files.sort((a, b) => a.mtimeMs - b.mtimeMs).filter(file => {
    if (total <= MAX_PASSAGE_BYTES) return false;
    total -= file.size;
    return true;
  });
  await Promise.all(evicted.map(file => rm(file.file, { force: true })));
}
