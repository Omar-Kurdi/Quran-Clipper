#!/usr/bin/env node
/**
 * Moves one cut of a chapter reciter's surah -- where one ayah's file ends and
 * the next one's starts -- without cutting the surah again. The two files are
 * frames copied from the recording, so laid end to end they are that stretch
 * of it bit for bit; they are split again at the new point and nothing else of
 * the surah is touched.
 *
 *   node scripts/qf-move-cut.mjs --reciter qfc-19 --surah 38 --ayah 70 --from 69 --at 9.0 [--recording 038.mp3]
 *   node scripts/qf-move-cut.mjs --reciter qfc-19 --surah 70 --ayah 17 --confirm [--recording 070.mp3]
 *
 * `--at` is where ayah `--ayah` starts, in seconds from the start of ayah
 * `--from`'s file (a passage's clock in the studio, when the passage starts
 * there); the cut goes in the pause nearest it, or for a run-on at the quietest
 * point right at it (`manualCut`). `--confirm` keeps the cut where it is.
 * Either way the join is no longer unsure. With `--recording`, the whole
 * surah's recording, the cut is written to scripts/qf-manual-cuts.json too, so
 * cutting the surah again keeps it.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { framesMs, frameAt, levels, manualCut, mp3Frames } from './qf-chapter-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO = process.env.QC_QF_AUDIO_DIR ||
  path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'quran-clipper', 'qf-audio');
const RATE = 16000;
const pad = n => String(n).padStart(3, '0');

const args = process.argv.slice(2);
const value = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const reciter = value('--reciter');
const surah = Number(value('--surah'));
const ayah = Number(value('--ayah'));
const confirm = args.includes('--confirm');
const from = Number(value('--from') ?? ayah - 1);
const at = Number(value('--at'));
const recording = value('--recording');
const chapterId = Number(String(reciter).replace(/^qfc-/, ''));
if (!(chapterId > 0) || !(surah >= 1 && surah <= 114) || !(ayah > 1) || (!confirm && !Number.isFinite(at))) {
  console.log('Usage: node scripts/qf-move-cut.mjs --reciter qfc-<id> --surah N --ayah A (--at SECONDS [--from AYAH] | --confirm) [--recording FILE]');
  process.exit(2);
}

const dir = path.join(AUDIO, `c${chapterId}`);
const chapterFile = path.join(dir, `${pad(surah)}.json`);
const chapter = JSON.parse(readFileSync(chapterFile, 'utf8'));
const index = chapter.ayahs.findIndex(entry => entry.ayah === ayah);
const fromIndex = chapter.ayahs.findIndex(entry => entry.ayah === from);
if (index < 1 || fromIndex < 0 || fromIndex > index - 1) throw new Error(`no join before ${surah}:${ayah} counted from ${surah}:${from}`);
const before = chapter.ayahs[index - 1];
const after = chapter.ayahs[index];

/** The two files' frames, as one run. */
const bytes = [before, after].map(entry => readFileSync(path.join(dir, entry.file)));
const parsed = bytes.map(mp3Frames);
const frames = [...parsed[0].frames.map(frame => ({ ...frame, part: 0 })), ...parsed[1].frames.map(frame => ({ ...frame, part: 1 }))];
const { rate, samples } = parsed[0];
const oldSplit = parsed[0].frames.length;

let split = oldSplit;
if (!confirm) {
  // Where `--at` falls in the pair: past the files between `--from` and the ayah before.
  const lead = chapter.ayahs.slice(fromIndex, index - 1).reduce((sum, entry) => sum + entry.ms, 0) / 1000;
  const pcm = decode(Buffer.concat(bytes));
  const cut = manualCut({ at: at - lead, after: 0.3, db: levels(pcm, RATE, undefined, 1 / 32768), silences: [] });
  split = Math.min(frames.length - 1, Math.max(1, frameAt(cut.at, rate, samples)));
}

const shift = framesMs(split, rate, samples) - framesMs(oldSplit, rate, samples);
if (split !== oldSplit) {
  const pieces = [frames.slice(0, split), frames.slice(split)];
  pieces.forEach((piece, i) => {
    const entry = [before, after][i];
    const partial = path.join(dir, `${entry.file}.${process.pid}.part`);
    writeFileSync(partial, Buffer.concat(piece.map(frame => bytes[frame.part].subarray(frame.offset, frame.offset + frame.size))));
    renameSync(partial, path.join(dir, entry.file));
  });
  before.ms = framesMs(split, rate, samples);
  after.ms = framesMs(frames.length - split, rate, samples);
  // Each ayah's words where they were in the recording, on its file's new clock: the ayah before keeps those
  // left in its file, and a word of the ayah after that its timings put before the new cut opens its file.
  before.segments = before.segments
    .map(([word, start, end]) => [word, start, Math.min(before.ms, end)])
    .filter(([, start, end]) => end > start);
  const moved = after.segments.map(([word, start, end]) => [word, Math.round(start - shift), Math.min(after.ms, Math.round(end - shift))]);
  const firstHeard = moved.find(([, start]) => start > 0)?.[1] ?? after.ms;
  after.segments = moved
    .map(([word, start, end]) => (start < 0 ? [word, 0, Math.max(Math.min(end, firstHeard), 1)] : [word, start, end]))
    .filter(([, start, end]) => end > start);
}

chapter.unsure = (chapter.unsure ?? []).filter(join => join.ayah !== ayah);
if (!chapter.unsure.length) delete chapter.unsure;
writeFileSync(`${chapterFile}.${process.pid}.part`, JSON.stringify(chapter));
renameSync(`${chapterFile}.${process.pid}.part`, chapterFile);
listUnsure();
// The stitched passages made from the old files.
for (const name of readdirSync(path.join(AUDIO, 'passages')).filter(name => name.startsWith(`qfc-${chapterId}-${pad(surah)}-`))) {
  rmSync(path.join(AUDIO, 'passages', name), { force: true });
}

const fileStart = chapter.ayahs.slice(0, index).reduce((sum, entry) => sum + entry.ms, 0) / 1000;
console.log(`  ${surah}:${ayah} ${confirm ? 'kept' : `moved ${(shift / 1000).toFixed(2)} s`}: ${before.ms / 1000} s and ${after.ms / 1000} s; ` +
  `${fileStart.toFixed(2)} s into the files`);
if (recording) {
  // On the recording's clock: what precedes the first ayah's file is in no file.
  const opening = probeSeconds(recording) - chapter.ayahs.reduce((sum, entry) => sum + entry.ms, 0) / 1000;
  const seconds = Math.round((opening + fileStart) * 100) / 100;
  const file = path.join(ROOT, 'scripts', 'qf-manual-cuts.json');
  const manual = JSON.parse(readFileSync(file, 'utf8'));
  manual[chapterId] ??= {};
  manual[chapterId][surah] = { ...(manual[chapterId][surah] ?? {}), [ayah]: seconds };
  const sorted = Object.fromEntries(Object.entries(manual[chapterId]).sort(([a], [b]) => Number(a) - Number(b)));
  manual[chapterId] = Object.fromEntries(Object.entries(sorted).map(([key, cuts]) =>
    [key, Object.fromEntries(Object.entries(cuts).sort(([a], [b]) => Number(a) - Number(b)))]));
  writeFileSync(file, `${JSON.stringify(manual, null, 2)}\n`);
  console.log(`  recorded in scripts/qf-manual-cuts.json at ${seconds} s`);
}

function decode(mp3) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', String(RATE), '-f', 's16le', 'pipe:1'],
    { input: mp3, maxBuffer: 1 << 30 });
  return new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
}

function probeSeconds(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
}

/** Every unsure join of the reciter's surahs in unsure.json, as the cutter writes it. */
function listUnsure() {
  const list = {};
  for (const name of readdirSync(dir).filter(name => /^\d{3}\.json$/.test(name)).sort()) {
    const unsure = JSON.parse(readFileSync(path.join(dir, name), 'utf8')).unsure;
    if (unsure?.length) list[Number(name.slice(0, 3))] = unsure;
  }
  const file = path.join(dir, 'unsure.json');
  if (Object.keys(list).length) writeFileSync(file, `${JSON.stringify(list, null, 1)}\n`);
  else if (existsSync(file)) rmSync(file);
}
