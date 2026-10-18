#!/usr/bin/env node
/**
 * The built-in reciters: the Quran Foundation's recitations published one
 * audio file per ayah, kept on this machine.
 *
 *   node scripts/qf-reciters.mjs download [--reciter qf-3,qf-4] [--surah 12]   fetch what is missing (resumable)
 *   node scripts/qf-reciters.mjs status                                       how much of each is on disk
 *   node scripts/qf-reciters.mjs counts                                       the same as one line, for scripts
 *   node scripts/qf-reciters.mjs check                                        recitations QF has that the studio does not
 *   node scripts/qf-reciters.mjs add [qfId ...]                               add them (all new ones by default) and fetch them
 *   node scripts/qf-reciters.mjs sync [--if-due] [--quiet]                    bring what is on disk up to date (Content Sync)
 *   node scripts/qf-reciters.mjs synced                                       when that last happened, as one line
 *   node scripts/qf-reciters.mjs cut --reciter qfc-159 [--share 50] [--aligners url,url]  cut chapter reciters ahead of time (./cut_reciters runs it)
 *   node scripts/qf-reciters.mjs cut-status                                   how far that has got, for each chapter reciter
 *
 * One file per ayah is why these are exact: an ayah starts where its file
 * starts, so no timing has to be measured or trusted to know where it begins
 * and ends. Kept in ~/.local/share/quran-clipper/qf-audio/ (QC_QF_AUDIO_DIR to
 * move it), outside the checkout, which `next build` reads whole. Each chapter
 * is kept as its ayah files plus `SSS.json`, written
 * only once every file of the chapter is here, holding each ayah's length --
 * counted in MP3 frames, so the files laid end to end add up to the sample --
 * and QF's word timings within it.
 *
 * The Foundation's chapter-only reciters -- whole-surah recordings with ayah
 * timings beside them, `chapterReciters` in the catalog, ids `qfc-<id>` --
 * are cut into the same one file per ayah here, by the aligner rather than by
 * those timings (scripts/qf-chapter-plan.mjs says why and how), and kept the
 * same way in `c<id>/`. Cutting needs the alignment service running; a
 * chapter whose every join cannot be placed is not kept, and `SSS.rejected.json`
 * says why, so it is not tried again until the Foundation changes it.
 *
 * Reads QF through the client id and secret in `.env.local` when they are set,
 * otherwise through the open api.quran.com, which serves the same recitations.
 *
 * `sync` keeps what is on disk within the Foundation's Developer Terms: stored
 * content may be kept past a week only when it is maintained through their
 * Content Sync APIs, synced at least every seven days. It needs the client id
 * and secret (Content Sync has no open equivalent). start.sh runs it when due,
 * and so does the studio's server every few hours (src/instrumentation.ts).
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile } from 'node:child_process';
import { closeSync, createWriteStream, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { apiPath, chapterStale, mutationPlan, normalSegments, recordsBySurah, syncDue, withSources } from './qf-sync-plan.mjs';
import {
  afterOpening, ayahBounds, ayahSegments, chapterPace, chapterProblems, chapterRecordsBySurah, cutStale, frameAt, framesMs, joinCut, levels,
  inPause, manualCut, mergedSilences, MIN_AGREEMENT, MIN_AYAH_SEC, mp3Frames, SEPARATE_LETTERS, nextWindow, qfAgrees, qfGap, qfWordsFit,
} from './qf-chapter-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(ROOT, 'src', 'lib', 'qfReciters.json');
/** Outside the checkout: `next build` reads everything inside it (see qfRecitations.ts). */
const AUDIO = process.env.QC_QF_AUDIO_DIR ||
  path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'quran-clipper', 'qf-audio');
const OPEN_API = 'https://api.quran.com/api/v4';
const FILE_HOST = 'https://verses.quran.com/';
const USER_AGENT = 'Quran-Clipper (+https://github.com/Omar-Kurdi/Quran-Clipper)';
const AYAHS = [7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64,
  77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55,
  78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25,
  22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6];
const PARALLEL = Number(process.env.QF_PARALLEL) || 12;
/** Surahs fetched at once, each with `PARALLEL` files at a time. */
const CHAPTERS_AT_ONCE = 2;
/**
 * The only hosts this script talks to: the Foundation's API and sign-in, the
 * open API, and the hosts its recitations name. A file address comes from an
 * API answer, so it is checked rather than fetched as given.
 */
const ALLOWED_HOSTS = new Set([
  'apis.quran.foundation', 'oauth2.quran.foundation', 'apis-prelive.quran.foundation', 'prelive-oauth2.quran.foundation',
  'api.quran.com', 'verses.quran.com', 'mirrors.quranicaudio.com', 'download.quranicaudio.com',
]);
const execFileAsync = promisify(execFile);

// -- QF access ------------------------------------------------------------------------------------------------------

/** `.env.local` and `.env`, as the studio reads them, without overriding the environment. */
function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(ROOT, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

function foundation() {
  const id = (process.env.QURAN_FOUNDATION_CLIENT_ID || '').trim();
  const secret = (process.env.QURAN_FOUNDATION_CLIENT_SECRET || '').trim();
  if (!id || !secret) return null;
  const prelive = (process.env.QURAN_FOUNDATION_ENV || 'live').trim().toLowerCase() === 'prelive';
  return {
    id, secret,
    content: prelive ? 'https://apis-prelive.quran.foundation/content/api/v4' : 'https://apis.quran.foundation/content/api/v4',
    oauth: prelive ? 'https://prelive-oauth2.quran.foundation/oauth2/token' : 'https://oauth2.quran.foundation/oauth2/token',
  };
}

let token = null;

/** fetch(), for an https address on `ALLOWED_HOSTS` only, or the alignment service (`asr`) that cuts chapter recordings. */
function fetchAllowed(url, init) {
  const { protocol, hostname, origin } = new URL(url);
  const allowed = (protocol === 'https:' && ALLOWED_HOSTS.has(hostname)) || (asr() && origin === new URL(asr()).origin);
  if (!allowed) throw new Error(`${hostname} is not a host this script fetches from`);
  return fetch(url, init);
}

async function foundationToken(qf) {
  if (token && token.until > Date.now()) return token.value;
  const res = await fetchAllowed(qf.oauth, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${qf.id}:${qf.secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials&scope=content',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  token = { value: data.access_token, until: Date.now() + ((data.expires_in || 3600) - 120) * 1000 };
  return token.value;
}

/** A v4 content path from QF where its keys are set, else (or when it fails) from the open API. */
async function api(pathAndQuery, timeoutMs = 60_000) {
  const qf = foundation();
  let refused = '';
  if (qf) {
    try {
      const auth = await foundationToken(qf);
      if (auth) {
        const res = await fetchAllowed(`${qf.content}${pathAndQuery}`, {
          headers: { 'x-auth-token': auth, 'x-client-id': qf.id, Accept: 'application/json', 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) return await res.json();
        refused = `the Quran Foundation answered ${res.status}`;
      } else {
        refused = 'the Quran Foundation refused the keys';
      }
    } catch (err) {
      // Unreachable or refused: the open API answers the same, and says so if it fails too.
      refused = `the Quran Foundation could not be reached (${err.message})`;
    }
  }
  const res = await fetchAllowed(`${OPEN_API}${pathAndQuery}`, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${pathAndQuery} answered ${res.status}${refused ? `, and ${refused}` : ''}`);
  return res.json();
}

// -- The catalog ----------------------------------------------------------------------------------------------------

const readCatalog = () => JSON.parse(readFileSync(CATALOG, 'utf8'));
const writeCatalog = catalog => writeFileSync(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`);

/** Every recitation QF publishes per ayah, with its English and Arabic names. */
async function qfRecitations(timeoutMs) {
  const [en, ar] = await Promise.all([
    api('/resources/recitations?language=en', timeoutMs),
    api('/resources/recitations?language=ar', timeoutMs).catch(() => ({ recitations: [] })),
  ]);
  const arabic = new Map((ar.recitations || []).map(r => [r.id, r.translated_name?.name]));
  return (en.recitations || []).map(r => ({
    qfId: r.id,
    name: r.style ? `${r.reciter_name} (${r.style})` : r.reciter_name,
    arabicName: arabic.get(r.id) || r.reciter_name,
    style: r.style || 'Murattal',
  }));
}

/** Those the studio does not offer yet and has not excluded. */
async function newRecitations(timeoutMs) {
  const catalog = readCatalog();
  const known = new Set([...catalog.reciters, ...catalog.excluded].map(r => r.qfId));
  return (await qfRecitations(timeoutMs)).filter(r => !known.has(r.qfId));
}

/** Every reciter offered: one file per ayah from QF, then the chapter recordings cut here. */
const allReciters = (catalog = readCatalog()) => [...catalog.reciters, ...(catalog.chapterReciters ?? [])];
/** A reciter's folder in AUDIO: QF's recitation id, or `c` and its chapter-reciter id (QF numbers the two apart). */
const dirOf = reciter => (reciter.chapterId ? `c${reciter.chapterId}` : String(reciter.qfId));
/** A reciter's entry in sync.json: the recitation id as it always was, the studio's id for a chapter reciter. */
const keyOf = reciter => (reciter.chapterId ? reciter.id : reciter.qfId);

/** Chapter-only reciters QF publishes that the studio neither offers nor has excluded, in the shape of `qfRecitations`. */
async function newChapterReciters(timeoutMs) {
  const catalog = readCatalog();
  const known = new Set([...(catalog.chapterReciters ?? []), ...(catalog.chapterExcluded ?? [])].map(r => r.chapterId));
  const { reciters = [] } = await api('/resources/chapter_reciters?language=en', timeoutMs);
  return reciters.filter(r => !known.has(r.id)).map(r => ({
    chapterId: r.id,
    name: r.name,
    arabicName: r.name,
    style: r.style?.name || 'Murattal',
  }));
}

// -- Files ----------------------------------------------------------------------------------------------------------

const pad = n => String(n).padStart(3, '0');
/** A surah's chapter file in a reciter's folder (`dirOf`; a recitation id is its own folder). */
const chapterFile = (folder, surah) => path.join(AUDIO, String(folder), `${pad(surah)}.json`);
const fileUrl = url => (url.startsWith('//') ? `https:${url}` : /^https?:/.test(url) ? url : FILE_HOST + url.replace(/^\//, ''));

/** One chapter's ayah files and word timings from QF, every page of them. */
async function chapterListing(qfId, surah, page = 1) {
  const data = await api(`/recitations/${qfId}/by_chapter/${surah}?fields=segments&per_page=300&page=${page}`);
  const files = data.audio_files || [];
  return data.pagination?.next_page ? [...files, ...await chapterListing(qfId, surah, page + 1)] : files;
}

/** One file, kept only whole; tried four times, a little later each time. */
async function download(url, target, attempt = 1) {
  const partial = `${target}.${process.pid}.part`;
  try {
    const res = await fetchAllowed(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(120_000) });
    if (!res.ok || !res.body) throw new Error(`${url} answered ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(partial));
    const expected = Number(res.headers.get('content-length'));
    if (expected && (await stat(partial)).size !== expected) throw new Error(`${url} arrived cut short`);
    await rename(partial, target);
  } catch (err) {
    await rm(partial, { force: true });
    if (attempt >= 4) throw err;
    await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    await download(url, target, attempt + 1);
  }
}

/**
 * An ayah file's length in milliseconds, from its frame count: what a player
 * and the stitched passage actually play, so the files laid end to end land
 * every ayah where it is. (The container's own duration leaves out the
 * encoder's padding, which the stitched file plays.)
 */
async function lengthMs(file) {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'a:0',
    '-show_entries', 'stream=nb_read_packets,sample_rate', '-of', 'json', file]);
  const stream = JSON.parse(stdout).streams?.[0];
  const rate = Number(stream?.sample_rate);
  const frames = Number(stream?.nb_read_packets);
  if (!rate || !frames) throw new Error(`${file} has no audio`);
  // MPEG-1 layer III frames hold 1152 samples; MPEG-2 and 2.5 (under 32 kHz) hold 576.
  return Math.round((frames * (rate >= 32000 ? 1152 : 576) * 1000 / rate) * 1000) / 1000;
}

/** `work` on every item, `width` at a time. */
async function inParallel(items, work, width = PARALLEL) {
  let next = 0;
  const worker = async () => {
    if (next >= items.length) return;
    await work(items[next++]);
    await worker();
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
}

/**
 * One chapter of one reciter, fetched where missing; true once it is complete
 * on disk. `records` are its ayah files from a Content Sync snapshot, when a
 * sync is replacing it; otherwise they are listed afresh.
 */
async function fetchChapter(qfId, surah, records = null) {
  if (existsSync(chapterFile(qfId, surah))) return true;
  if (removedRecitation(qfId)) throw new Error(`the Quran Foundation no longer publishes recitation ${qfId}`);
  const dir = path.join(AUDIO, String(qfId));
  await mkdir(dir, { recursive: true });
  const listing = records ?? await chapterListing(qfId, surah);
  if (listing.length !== AYAHS[surah - 1]) throw new Error(`QF lists ${listing.length} ayahs of ${surah} for ${qfId}, not ${AYAHS[surah - 1]}`);
  const ayahs = [];
  await inParallel(listing, async entry => {
    const ayah = Number(String(entry.verse_key).split(':')[1]);
    const name = `${pad(surah)}${pad(ayah)}.mp3`;
    const target = path.join(dir, name);
    if (!existsSync(target)) await download(fileUrl(entry.url), target);
    ayahs.push({
      ayah,
      file: name,
      ms: await lengthMs(target),
      // QF's word timings within the file: [word index, word number, start, end], ms.
      // Some recitations send these as strings ("380"); kept as numbers.
      segments: normalSegments(entry.segments),
      // Where it came from and when QF last changed it, for `sync` to compare.
      url: entry.url,
      updatedAt: entry.updated_at ?? null,
    });
  });
  ayahs.sort((a, b) => a.ayah - b.ayah);
  await writeFile(chapterFile(qfId, surah), JSON.stringify({ qfId, surah, ayahs }));
  return true;
}

/** One surah of any reciter on disk: fetched as QF's ayah files, or cut from its chapter recording. */
const fetchSurah = (reciter, surah, fresh = null) =>
  (reciter.chapterId ? cutChapter(reciter, surah, fresh) : fetchChapter(reciter.qfId, surah, fresh));

// -- Chapter recordings, cut into ayahs -----------------------------------------------------------------------------

/**
 * The alignment service, which places every ayah of a chapter recording
 * before it is cut: `ASR_SERVICE_URL` from `.env.local`, else the one
 * ./start.sh started (`QC_STARTED_ALIGNER`). Read when used: `.env.local` is loaded after this module.
 */
const asr = () => (workerAligner.getStore() || process.env.ASR_SERVICE_URL || process.env.QC_STARTED_ALIGNER || '').replace(/\/$/, '');
/** The aligner one `cut` worker uses, when it runs several (`--aligners`), each its own. */
const workerAligner = new AsyncLocalStorage();
const alignerNeeded = () => (asr() ? `it is not answering at ${asr()} (./start.sh starts it)` : 'run ./start.sh, which starts it, or set ASR_SERVICE_URL in .env.local');
const PCM_RATE = 16000;
/** The lengths a window is read at, in turn, until it reads well, every ayah it needs is placed and the next one fits. */
const STRETCHES = [1, 1.5, 2.25, 0.75];
/** A Foundation gap this narrow between two ayahs run together is exact enough to cut at. */
const QF_EXACT_SEC = 0.5;
/** And the aligner's start for the next ayah must be this near the Foundation's, for a cut with no pause. */
const QF_EXACT_ALIGNER_SEC = 0.3;
/** How far past the end of a pause the Foundation may start the next ayah and still mean that pause. */
const QF_LATE_SEC = 1.5;
/** How far after the next ayah's start a word of the ayah before still tangles the two. */
const TANGLE_SEC = 10;
const rejectedFile = (folder, surah) => path.join(AUDIO, folder, `${pad(surah)}.rejected.json`);

/**
 * `work`, tried again a little later when it fails: cutting a surah takes
 * minutes of the aligner, and the recordings' host has refused connections
 * for a minute at a time (2026-10-17), which should not lose them.
 */
async function patiently(work, attempt = 1) {
  try {
    return await work();
  } catch (err) {
    if (attempt >= 3) throw err;
    await new Promise(resolve => setTimeout(resolve, 20_000 * attempt));
    return patiently(work, attempt + 1);
  }
}

/** One surah's recording and ayah timings, from the Content Sync snapshot or asked for afresh. */
async function chapterRecording(reciter, surah) {
  const { audio_file: file } = await api(`/chapter_recitations/${reciter.chapterId}/${surah}?segments=true`);
  if (!file?.audio_url) throw new Error(`QF lists no recording of surah ${surah} for ${reciter.name}`);
  return {
    file: { audio_url: file.audio_url, file_size: file.file_size, updated_at: file.updated_at ?? null },
    ayahs: file.timestamps ?? [],
  };
}

/** An ayah timing as the API and the snapshot give it (the snapshot's as text), in numbers. */
const timingOf = record => ({
  ayah: Number(record.verse_number ?? String(record.verse_key).split(':')[1]),
  timestamp_from: Number(record.timestamp_from),
  timestamp_to: Number(record.timestamp_to),
  segments: typeof record.segments === 'string' ? JSON.parse(record.segments) : record.segments ?? [],
});

/** The surah's words as the aligner is given them: one token per word, `[{ ayah, words }]`. */
async function chapterText(surah) {
  const { verses = [] } = await api(`/verses/by_chapter/${surah}?words=true&word_fields=text_uthmani&per_page=300`);
  return verses.map(verse => ({
    ayah: verse.verse_number,
    words: verse.words.filter(word => word.char_type_name === 'word').map(word => word.text_uthmani.replace(/\s+/g, '')),
  }));
}

/** The recording decoded for the aligner: 16 kHz mono, 16-bit. */
async function decoded(file) {
  const { stdout } = await execFileAsync('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-ac', '1', '-ar', String(PCM_RATE),
    '-f', 's16le', '-'], { encoding: 'buffer', maxBuffer: 2 ** 31, timeout: 10 * 60_000 });
  return new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 2));
}

/** `pcm` from `from` to `to` seconds, as a WAV file to send. */
function wavOf(pcm, from, to) {
  const samples = pcm.subarray(Math.floor(from * PCM_RATE), Math.ceil(to * PCM_RATE));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples.byteLength, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(PCM_RATE, 24);
  header.writeUInt32LE(PCM_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples.byteLength, 40);
  return new Blob([header, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)], { type: 'audio/wav' });
}

/** The alignment service's reading of one window: ayah bounds, words, silences and openings on the recording's clock. */
/**
 * The basmala, as a line of the aligner's text: given it, the aligner places
 * it and the first ayah apart. Not given it, it can lose the first ayahs of a
 * recitation that runs straight on from the basmala -- Saad al-Ghamdi's 95:1
 * and 95:2 got no word at all; with it, both landed where the Foundation puts them.
 */
const BASMALA_LINE = '1:1\tبِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ';

async function alignWindow(pcm, surah, verses, window, { basmala = false, whole: given = null } = {}) {
  await whilePaused();
  const started = Date.now();
  const form = new FormData();
  form.append('audio', wavOf(pcm, window.from, window.to), 'window.wav');
  const lines = verses.slice(window.first, window.last + 1).map(verse => `${surah}:${verse.ayah}\t${verse.words.join(' ')}`);
  form.append('reference', (basmala ? [BASMALA_LINE, ...lines] : lines).join('\n'));
  // A window from the recording's start, or to its end, holds every ayah of its text there: the aligner then
  // restores an ayah at that end no phrase claimed (Saad al-Ghamdi's 107:7, run on from 107:6).
  const whole = given ? [given] : [window.first === 0 && window.from === 0 && 'start', window.final && 'end'].filter(Boolean);
  if (whole.length) form.append('whole', whole.length === 2 ? 'both' : whole[0]);
  const res = await fetchAllowed(`${asr()}/align`, { method: 'POST', body: form, signal: AbortSignal.timeout(20 * 60_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`the aligner refused ${window.from.toFixed(1)}-${window.to.toFixed(1)}s: ${JSON.stringify(data.detail ?? data).slice(0, 200)}`);
  await giveWay(Date.now() - started);
  const all = (data.words ?? []).map(word => ({ ...word, start: word.start + window.from, end: word.end + window.from }));
  // The basmala given as a line is an opening, not the surah's first ayah.
  const words = all.filter(word => String(word.verse_key).startsWith(`${surah}:`));
  const said = basmala ? all.filter(word => word.verse_key === '1:1') : [];
  const heard = (data.openings ?? []).map(opening => ({ ...opening, start: opening.start + window.from, end: opening.end + window.from }));
  return {
    bounds: ayahBounds(words),
    words,
    heard,
    agreement: data.decodeAgreement ?? null,
    silences: mergedSilences((data.silences ?? []).map(([start, end]) => [start + window.from, end + window.from])),
    openings: said.length
      ? [...heard.filter(opening => opening.kind !== 'basmala' && opening.end <= said[0].start + 0.1),
        { kind: 'basmala', start: said[0].start, end: Math.max(...said.map(word => word.end)) }]
      : heard,
  };
}

/** Whether the alignment service is up and can align. */
async function aligner() {
  if (!asr()) return false;
  try {
    // A busy service answers slowly: it may be aligning another surah.
    const res = await fetchAllowed(`${asr()}/health`, { signal: AbortSignal.timeout(60_000) });
    return res.ok && (await res.json()).alignReady === true;
  } catch {
    return false;
  }
}

/**
 * One window read, and read again longer when the ayahs past the kept ones
 * do not fit in it -- the aligner would have squeezed them in at its end.
 */
/**
 * A window's reading. The first of a surah that opens with a basmala (all but
 * 1 and 9) is read with it in the text and without, and the reading that
 * agrees better with what was heard is kept: a reciter who leaves it out
 * reads worse with it forced in.
 */
async function readOnce(chapter, window) {
  const read = await alignWindow(chapter.pcm, chapter.surah, chapter.verses, window);
  if (window.first !== 0 || chapter.surah === 1 || chapter.surah === 9) return read;
  const withBasmala = await alignWindow(chapter.pcm, chapter.surah, chapter.verses, window, { basmala: true });
  // What the phoneme model heard of the opening on its own, which the reading given the basmala as text does not say.
  return (withBasmala.agreement ?? 0) > (read.agreement ?? 0) ? { ...withBasmala, heard: read.heard } : read;
}

async function readWindow(chapter, first, from, tries = 0) {
  const window = nextWindow({ verses: chapter.verses, first, from, duration: chapter.duration, pace: chapter.pace, stretch: STRETCHES[tries] });
  const read = await readOnce(chapter, window);
  const needed = chapter.verses.slice(window.first, (window.final ? window.keep : window.keep + 1) + 1);
  // An ayah left out -- the aligner gave Al-Muaiqly's 5:83 no word in one window and all 21 in another --
  // is read again over a window of another length, as is one whose next ayah was squeezed in at its end.
  const placedAll = needed.every((verse, i) => read.bounds.has(verse.ayah) || (i === 0 && first === 0));
  const next = window.final ? null : read.bounds.get(chapter.verses[window.keep + 1].ayah);
  const fits = window.final || (next && next.start < window.to - 2);
  // A reading that agrees too little with its text is read again too: Al-Muaiqly's 3:76-81 read 0.44 in one
  // window and 0.66 and 0.61 over others.
  const readWell = read.agreement >= MIN_AGREEMENT;
  if (process.env.QC_CUT_DEBUG) {
    const missing = needed.filter(verse => !read.bounds.has(verse.ayah)).map(verse => verse.ayah);
    console.error(`  window ${window.from.toFixed(1)}-${window.to.toFixed(1)}s ayahs ${chapter.verses[window.first].ayah}-${chapter.verses[window.last].ayah}` +
      ` keep to ${chapter.verses[window.keep].ayah}: agreement ${read.agreement}${missing.length ? `, no word of ${missing.join(', ')}` : ''}${fits ? '' : ', next not in'}`);
  }
  if ((placedAll && fits && readWell) || tries + 1 >= STRETCHES.length) return { window, read };
  return readWindow(chapter, first, from, tries + 1);
}

/**
 * A first ayah the aligner gave no word -- an ayah of separate letters, held
 * long (Saad al-Ghamdi's يسٓ) -- taken to run from the start of the
 * recording, or the end of an opening heard, to the next ayah's first word.
 * Its file is then cut by the same pauses as any other.
 */
function placeUnread(chapter, read) {
  const next = read.bounds.get(chapter.verses[1]?.ayah);
  if (!next) return;
  const opened = read.openings.filter(opening => opening.start < next.start).map(opening => opening.end);
  const start = opened.length ? Math.max(...opened) : 0;
  read.bounds.set(chapter.verses[0].ayah, { start, end: start, missing: true });
}

/**
 * The pause after the basmala where the phoneme model hears it end before the
 * aligner does: given the basmala as text, the aligner can read it on into
 * the first ayah -- Al-Ajmy's surahs open with a basmala in another voice, a
 * break of 0.3-1 s, then his letters said by name, which the aligner gave to
 * the basmala (7:1's «الٓمٓصٓ» at 5.3 s, the break at 2.3-2.7 s).
 */
function earlyOpening(chapter, read, openingStart, openingEnd) {
  const heardEnd = Math.max(...read.heard.filter(opening => opening.kind === 'basmala').map(opening => opening.end));
  if (!Number.isFinite(heardEnd) || !(heardEnd < openingEnd - PAIR_SLACK_SEC)) return null;
  const join = afterOpening({ openingStart, openingEnd: heardEnd, firstStart: heardEnd, db: chapter.db, silences: read.silences });
  return inPause(join) ? join : null;
}

/** Where the first ayah's file starts: after an opening heard before it, else at the start of the recording. */
function firstCut(chapter, read) {
  const ayah = chapter.verses[0].ayah;
  const start = read.bounds.get(ayah)?.start ?? 0;
  chapter.openings = read.openings.filter(opening => opening.start < start);
  if (!chapter.openings.length) return chapter.cuts.push(0);
  const openingEnd = Math.max(...chapter.openings.map(opening => opening.end));
  const openingStart = Math.min(...chapter.openings.map(opening => opening.start));
  const join = earlyOpening(chapter, read, openingStart, openingEnd) ??
    afterOpening({ openingStart, openingEnd, firstStart: start, db: chapter.db, silences: read.silences });
  if (process.env.QC_CUT_DEBUG) console.error(`  opening: ${JSON.stringify(chapter.openings)} heard ${JSON.stringify(read.heard.map(o => [o.kind, o.start, o.end]))} first ayah starts ${start}, cut ${JSON.stringify(join)}`);
  const timing = chapter.qf.get(ayah);
  chapter.joins.push({ ayah, opening: true, ...join, qf: qfAgrees(join, { timestamp_to: timing?.timestamp_from }, timing) });
  return chapter.cuts.push(join.at);
}

/** What one window placed: each ayah's start (every ayah it read), and the words and bounds of those it keeps. */
function keepPlaced(chapter, window, read) {
  for (let i = window.first; i <= window.last; i++) {
    const { ayah } = chapter.verses[i];
    const placed = read.bounds.get(ayah);
    // Past the join after the kept ayahs, an ayah the window only reached the edge of is placed by the next one.
    if (!placed && i > window.keep + 1) continue;
    if (!placed) throw new Error(`the aligner placed no word of ayah ${ayah}`);
    if (!placed.missing) chapter.starts.set(ayah, [...(chapter.starts.get(ayah) ?? []), placed.start]);
    if (i > window.keep) continue;
    chapter.words.set(ayah, read.words.filter(word => word.verse_key === `${chapter.surah}:${ayah}`));
    chapter.bounds.set(ayah, placed);
  }
}

/** The joins one window places: between each ayah it keeps and the next, the one after the last kept included. */
function windowJoins(chapter, window, read) {
  const last = window.final ? window.keep : window.keep + 1;
  for (let i = window.first + 1; i <= last; i++) {
    const before = chapter.verses[i - 1].ayah;
    const { ayah } = chapter.verses[i];
    const nextStart = read.bounds.get(ayah).start;
    const join = joinCut({ after: read.bounds.get(before).start + 0.3, nextStart, db: chapter.db, silences: read.silences });
    // Words of the ayah before placed after this one starts: the aligner has the two tangled.
    // Only near the join: Al-Muaiqly's 30:26 «ٱلسَّمَـٰوَٰتِ وَٱلْأَرْضِ», at a window's end before 30:26 was in its
    // text, was read as a repeat of 30:22's, 85 s after 30:23 began.
    const tangled = read.words.some(word => word.verse_key === `${chapter.surah}:${before}` &&
      word.start > nextStart && word.start < nextStart + TANGLE_SEC);
    chapter.joins.push({
      ayah, index: i, cut: chapter.cuts.length, nextStart, ...join, tangled, silences: read.silences,
      qf: qfAgrees(join, chapter.qf.get(before), chapter.qf.get(ayah)), qfGap: qfGap(chapter.qf.get(before), chapter.qf.get(ayah)),
      qfStart: chapter.qf.has(ayah) ? chapter.qf.get(ayah).timestamp_from / 1000 : null,
    });
    chapter.cuts.push(join.at);
  }
}

/** Every window from ayah index `first`, starting at `from` seconds, one after another. */
/**
 * Forgets what was placed from ayah index `index` on, so the window before can
 * be read again: the cut before an ayah no window can find was misplaced.
 */
function unplaceFrom(chapter, index) {
  chapter.cuts.length = index + 1;
  chapter.joins = chapter.joins.filter(join => join.index === undefined || join.index <= index);
  for (const verse of chapter.verses.slice(index)) {
    chapter.words.delete(verse.ayah);
    chapter.bounds.delete(verse.ayah);
    chapter.starts.delete(verse.ayah);
  }
}

async function placeFrom(chapter, first, from, tries = 0) {
  const { window, read } = await readWindow(chapter, first, from, tries);
  // The ayah a window starts with, never found: the window before put the cut before it too late -- Al-Muaiqly's
  // 5:79-83 started 5:83 where 5:84 does, 28 s on. That window is read again, longer, once.
  if (first > 1 && !read.bounds.has(chapter.verses[first].ayah) && !chapter.steppedBack.has(first)) {
    chapter.steppedBack.add(first);
    unplaceFrom(chapter, first - 1);
    return placeFrom(chapter, first - 1, chapter.cuts[first - 1], 1);
  }
  if (first === 0 && !read.bounds.has(chapter.verses[0].ayah)) placeUnread(chapter, read);
  chapter.windows.push({ from: window.from, to: window.to, agreement: read.agreement });
  if (first === 0) {
    chapter.firstSilences = read.silences;
    firstCut(chapter, read);
  }
  keepPlaced(chapter, window, read);
  windowJoins(chapter, window, read);
  // The next window starts at the cut before the first ayah it keeps, which it places again.
  if (!window.final) await placeFrom(chapter, window.keep + 1, chapter.cuts.at(-1));
}

/**
 * A join that is no pause, or one the Foundation does not put there, read again
 * with the two ayahs around it alone, from the cut before the first to the cut
 * after the second: `confirmed` where that reading puts the cut between the two
 * ayahs' words. Where it clearly puts it elsewhere, the cut goes in the pause
 * between the ayahs as it reads them (`movedByPair`), or the join is
 * `contradicted`. A dip is at every word boundary and a pause between words is
 * a pause: Saad al-Ghamdi's 80:6 was cut in the pause before 80:5's last word
 * «ٱسْتَغْنَىٰ», which only the reading of the two ayahs alone placed right.
 */
async function confirmJoin(chapter, join) {
  const { verses, cuts } = chapter;
  const pair = { first: join.index - 1, last: join.index, from: cuts[join.index - 1], to: cuts[join.index + 1] ?? chapter.duration };
  // Cuts out of order are refused by `chapterProblems`; there is nothing to read between them.
  if (!(pair.from < join.at && join.at < pair.to)) return;
  const again = await alignWindow(chapter.pcm, chapter.surah, verses, pair, { whole: 'both' });
  const said = again.bounds.get(verses[join.index - 1].ayah);
  const next = again.bounds.get(verses[join.index].ayah);
  const readWell = Boolean(said && next) && again.agreement >= MIN_AGREEMENT && said.end <= next.start + PAIR_SLACK_SEC;
  const fits = at => readWell && said.end <= at + PAIR_SLACK_SEC && next.start >= at - PAIR_SLACK_SEC;
  join.confirmed = fits(join.at);
  if (process.env.QC_CUT_DEBUG) console.error(`  pair ${join.ayah}: cut ${join.at} said ${said?.start}-${said?.end} next ${next?.start}-${next?.end} agreement ${again.agreement}`);
  if (join.confirmed || !readWell) return;
  // The quietest point between the two as read, never past the next ayah's start: where the reciter runs on
  // into a voiced letter there is no dip at the join, and the next one is inside the next ayah's first word --
  // Saad al-Ghamdi's 102:5-6, «ٱلْيَقِينِ لَتَرَوُنَّ», dips first at the ت, and the cut there left «لَ» in 102:5.
  const dip = joinCut({ after: Math.max(said.start + 0.3, said.end - PAIR_SLACK_SEC), nextStart: next.start, db: chapter.db, silences: join.silences });
  const between = (said.end + Math.max(said.end, next.start)) / 2;
  const recut = dip.at <= next.start ? dip : { at: between, from: between, until: between, depth: 0, overFloor: 0, heard: true };
  // Moved only where a second source stands by it: a pause, or the Foundation's timing.
  const qf = qfAgrees(recut, chapter.qf.get(verses[join.index - 1].ayah), chapter.qf.get(verses[join.index].ayah));
  if (process.env.QC_CUT_DEBUG) console.error(`    recut ${JSON.stringify({ at: recut.at, depth: recut.depth })} pause ${inPause(recut)} qf ${qf}`);
  if (!fits(recut.at) || !(inPause(recut) || qf)) {
    join.contradicted = true;
    return;
  }
  Object.assign(join, recut, { qf, confirmed: true, movedByPair: true, nextStart: next.start });
  // And the Foundation's join in the voice judged again for where the cut now is: Al-Ajmy's 16:119 moved from the
  // edge of the pause before «ثُمَّ» into it, with the Foundation 1.6 s on in his voice.
  join.qfInVoice = !qf && inPause(recut) && Boolean(join.qfCut) && !inPause(join.qfCut) && !join.tangled;
  cuts[join.cut] = recut.at;
  for (const ayah of [verses[join.index - 1].ayah, verses[join.index].ayah]) {
    chapter.words.set(ayah, again.words.filter(word => word.verse_key === `${chapter.surah}:${ayah}`));
  }
}

/**
 * How well the two ayah files a cut at `at` would make read, each alone
 * against its own text: the lower of their two agreements, 0 where either
 * reads as nothing. Independent of where any reading of the recording put the
 * join -- the aligner's first reading and its reading of the pair agreed on
 * Saad al-Ghamdi's 56:53 at 242.88 s, and 56:53 alone from there read as
 * nothing; from the Foundation's 241.26 s it read as its text.
 */
async function readsAlone(chapter, join, at) {
  const { verses, cuts } = chapter;
  const parts = [{ first: join.index - 1, last: join.index - 1, from: cuts[join.index - 1], to: at },
    { first: join.index, last: join.index, from: at, to: cuts[join.index + 1] ?? chapter.duration }];
  // A cut outside the ayahs either side makes no files to read: Al-Ajmy's 44 had the Foundation's past the next cut.
  if (!parts.every(part => part.to - part.from >= MIN_AYAH_SEC)) return 0;
  const reads = await Promise.all(parts.map(part => alignWindow(chapter.pcm, chapter.surah, verses, part, { whole: 'both' })));
  return Math.min(...reads.map((read, i) => read.bounds.has(verses[join.index - 1 + i].ayah) ? read.agreement ?? 0 : 0));
}

/**
 * A join the Foundation puts elsewhere, on a recording its timings fit, moved
 * to its cut where the files either side read clearly better alone there
 * (`readsAlone`). Only ever as a comparison: a cut a word off reads well
 * alone too -- Saad al-Ghamdi's 80:4 cut in the closure of «يَزَّكَّىٰٓ»'s كّ read
 * 1.0 and 0.89, the right cut 1.0 and 1.0 -- so how a cut reads alone never
 * keeps a join by itself.
 */
async function judgeJoin(chapter, join) {
  const [here, atQf] = await Promise.all([readsAlone(chapter, join, join.at), readsAlone(chapter, join, join.qfCut.at)]);
  if (process.env.QC_CUT_DEBUG) console.error(`  judge ${join.ayah}: ${join.at} reads ${here}, the Foundation's ${join.qfCut.at} ${atQf}`);
  if (atQf < MIN_AGREEMENT || atQf < here + JUDGE_MARGIN) return;
  Object.assign(join, join.qfCut, { qf: true, confirmed: true, judged: true, recutAtQf: true });
  chapter.cuts[join.cut] = join.at;
}

/** How much better the files at the Foundation's cut must read alone than at the aligner's for the join to move there. */
const JUDGE_MARGIN = 0.15;

/**
 * The cut after an opening the reciter runs straight on from, with no pause
 * and no timing of the Foundation's to go by (its timings start ayah 1 with
 * the basmala), read again with the basmala and the first ayah alone:
 * `confirmed` where that reading ends the one and starts the other at it.
 * Al-Ajmy runs his basmala into the first word in most surahs (56, 57, 61).
 * Never for an ayah of letters said by name, which neither reading places.
 */
async function confirmOpening(chapter, join) {
  if (SEPARATE_LETTERS.has(`${chapter.surah}:${chapter.verses[0].ayah}`)) return;
  const window = { first: 0, last: 0, from: 0, to: chapter.cuts[1] ?? chapter.duration };
  if (!(join.at < window.to)) return;
  const again = await alignWindow(chapter.pcm, chapter.surah, chapter.verses, window, { basmala: true, whole: 'end' });
  const basmala = again.openings.find(opening => opening.kind === 'basmala');
  const first = again.bounds.get(chapter.verses[0].ayah);
  join.confirmed = Boolean(basmala && first) && basmala.end <= join.at + PAIR_SLACK_SEC && first.start >= join.at - PAIR_SLACK_SEC &&
    again.agreement >= MIN_AGREEMENT;
}

/** How far past the cut a reading of the pair may put a word edge: word ends are read long, into the silence after. */
const PAIR_SLACK_SEC = 0.3;

/**
 * The first ayah's start, on a recording the Foundation's timings fit, put in
 * the pause just before where they start it, where it is not there already.
 * The openings the aligner hears can miss one: Al-Muaiqly's 36:1 was cut after
 * his isti'adha and before his basmala, which went into 36:1's file with يسٓ
 * 9 s in.
 */
function firstAtQf(chapter) {
  const first = chapter.qf.get(chapter.verses[0].ayah);
  if (!first) return;
  const firstWord = Number(first.segments?.[0]?.[1]);
  const starts = Math.max(first.timestamp_from, Number.isFinite(firstWord) ? firstWord : 0) / 1000;
  const opening = chapter.joins.find(join => join.opening);
  const cut = joinCut({ after: 0, nextStart: starts, db: chapter.db, silences: chapter.firstSilences });
  if (process.env.QC_CUT_DEBUG) console.error(`  first: the Foundation starts ${starts}, cut ${JSON.stringify(cut)}, opening ${JSON.stringify(opening && { at: opening.at, from: opening.from, until: opening.until, depth: opening.depth })}`);
  // Already there: nothing to move. Where the reciter runs straight on from the basmala there is no pause,
  // and the Foundation's start, which fits this recording, is cut at the quietest point by it.
  if (Math.abs(cut.at - chapter.cuts[0]) <= 0.15 || starts < 1) return;
  if (opening && inPause(opening) && qfAgrees(opening, { timestamp_to: first.timestamp_from }, first)) return;
  if (!inPause(cut) && opening && inPause(opening)) return;
  const join = { ayah: chapter.verses[0].ayah, opening: true, ...cut, qf: true, recutAtQf: true };
  if (opening) Object.assign(opening, join);
  else chapter.joins.unshift(join);
  chapter.cuts[0] = cut.at;
}

/**
 * The cut a join would get from the other window that placed its next ayah
 * (the ayahs read past a window's kept ones are placed again by the next),
 * for `chapterProblems` to see that the two agree.
 */
function secondCut(chapter, join) {
  if (join.index === undefined) return;
  const other = (chapter.starts.get(join.ayah) ?? []).find(start => start !== join.nextStart);
  if (other === undefined) return;
  const before = chapter.bounds.get(chapter.verses[join.index - 1].ayah);
  join.secondCut = joinCut({ after: before.start + 0.3, nextStart: other, db: chapter.db, silences: join.silences }).at;
}

/**
 * A join the aligner put elsewhere than the Foundation, on a recording whose
 * timings fit, cut again where those timings start the next ayah -- kept only
 * when that is a pause the phoneme model hears nothing in, so two sources
 * agree on it. (The aligner is the one confused there: Al-Muaiqly's and
 * Al-Tunaiji's 32:19 both started at the pause before 32:18's last words.)
 */
function recutAtQf(chapter, join) {
  const before = chapter.qf.get(chapter.verses[join.index - 1].ayah);
  const after = chapter.qf.get(chapter.verses[join.index].ayah);
  const firstWord = Number(after?.segments?.[0]?.[1]);
  if (!before || !after) return;
  const nextStart = Math.max(after.timestamp_from, Number.isFinite(firstWord) ? firstWord : 0) / 1000;
  // Never back past where the Foundation ends the ayah before: two seconds back from Saad al-Ghamdi's 93:2 is
  // the pause before 93:1, and «وَٱلضُّحَىٰ» was left 0.28 s.
  const lastWord = Number(before.segments?.at(-1)?.[2]);
  const closes = Math.min(before.timestamp_to, Number.isFinite(lastWord) ? lastWord : Infinity) / 1000;
  const recut = joinCut({ after: Math.max(before.timestamp_from / 1000 + 0.3, closes - 0.35), nextStart, db: chapter.db, silences: join.silences });
  if (process.env.QC_CUT_DEBUG) console.error(`  qf ${join.ayah}: closes ${closes} starts ${nextStart} recut ${JSON.stringify({ at: recut.at, from: recut.from, until: recut.until, depth: recut.depth })} pause ${inPause(recut)}`);
  // The pause just before where the Foundation starts the next ayah: its starts run late as well as early
  // (Al-Muaiqly's 68:12 a second after the pause that ends at 105.7 s).
  if (inPause(recut) && (qfAgrees(recut, before, after) || recut.until >= nextStart - QF_LATE_SEC)) {
    if (join.qf && inPause(join)) return;
    Object.assign(join, recut, { qf: true, nextStart, recutAtQf: true });
    chapter.cuts[join.cut] = recut.at;
    return;
  }
  // No pause anywhere near, and the Foundation's own gap narrow: the reciter ran straight on (Saad al-Ghamdi's
  // short surahs), and its timing is exact enough to cut by -- at the quietest point at its word boundary,
  // where the recording agrees.
  // Only where the aligner starts the next ayah there too: a dip is at every word boundary, and the Foundation's
  // timing can be a word off (Saad al-Ghamdi's 80:6, which it starts on 80:5's last word «ٱسْتَغْنَىٰ»).
  if (!inPause(join) && qfGap(before, after) <= QF_EXACT_SEC && qfAgrees(recut, before, after) &&
    Math.abs(join.nextStart - nextStart) <= QF_EXACT_ALIGNER_SEC) {
    Object.assign(join, recut, { qf: true, nextStart, recutAtQf: true, qfGap: qfGap(before, after) });
    chapter.cuts[join.cut] = recut.at;
    return;
  }
  // Where the Foundation's join is in the reciter's voice -- Al-Muaiqly's 21:52, which it starts 2 s into
  // the madd that ends 21:51 -- the aligner's join stands when it is a clean pause nothing of the ayah
  // before follows: then the voice, the pause and the aligner all say the Foundation's timing is wrong.
  join.qfInVoice = !inPause(recut) && inPause(join) && !join.tangled;
  join.qfCut = { ...recut, nextStart, qfGap: qfGap(before, after) };
}

/**
 * Every ayah of one recording placed by the aligner, a window at a time, and
 * every join cut (`joinCut`): `{ cuts, joins, windows, starts, words, ... }`,
 * cuts in seconds with the first ayah's start first.
 */
async function placeAyahs(pcm, surah, verses, timings) {
  const duration = pcm.length / PCM_RATE;
  const chapter = {
    pcm, surah, verses, duration,
    db: levels(pcm, PCM_RATE, undefined, 1 / 32768),
    pace: chapterPace(verses, duration),
    qf: new Map(timings.map(timing => [timing.ayah, timing])),
    windows: [], joins: [], cuts: [], openings: [], firstSilences: [], starts: new Map(), words: new Map(), bounds: new Map(),
    steppedBack: new Set(),
  };
  await placeFrom(chapter, 0, 0);
  for (const join of chapter.joins) secondCut(chapter, join);
  if (qfWordsFit(chapter.joins)) {
    firstAtQf(chapter);
    // Also a join that is no pause, the Foundation's or not: the aligner can start an ayah inside the last word
    // of the one before (Al-Muaiqly's 36:14 at 165.96 s, the pause 166.3-167.4 s), and there is a pause by them.
    for (const join of chapter.joins.filter(join => join.index !== undefined && (!join.qf || !inPause(join)))) recutAtQf(chapter, join);
  }
  // Every join that is no pause, or the Foundation's timings do not put there, is read again with its two ayahs alone.
  await Promise.all(chapter.joins.filter(join => join.index !== undefined && !join.tangled && (!inPause(join) || !join.qf))
    .map(join => confirmJoin(chapter, join)));
  const opening = chapter.joins.find(join => join.opening);
  if (opening && !inPause(opening) && !opening.qf) await confirmOpening(chapter, opening);
  // Then a join the Foundation puts elsewhere is moved there where its two files read clearly better alone.
  await Promise.all(chapter.joins.filter(join => join.index !== undefined && !join.tangled && !join.contradicted && !join.qfInVoice &&
    !join.qf && join.qfCut).map(join => judgeJoin(chapter, join)));
  for (const join of chapter.joins) delete join.qfCut;
  for (const join of chapter.joins) delete join.silences;
  return chapter;
}

/** A variable-bitrate recording made constant first, at about its own rate, so a passage cut from it can be seeked. */
async function constantBitrate(file, bitrate) {
  const target = `${file}.cbr.mp3`;
  const kbps = [64, 96, 128, 160, 192, 256, 320].find(rate => rate * 1000 >= bitrate) ?? 320;
  await execFileAsync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', file, '-map', '0:a', '-map_metadata', '-1',
    '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, '-write_xing', '0', target], { timeout: 30 * 60_000 });
  await rename(target, file);
}

/**
 * One surah of a chapter-only reciter, cut into ayah files: true once it is on
 * disk. Throws, and records why in `SSS.rejected.json`, when the recording
 * cannot be cut exactly (`chapterProblems`); a rejection stands until the
 * Foundation changes the recording or its timings.
 */
/**
 * One recording fetched and read: its MP3 frames (a variable-bitrate one made
 * constant first) and its sound decoded from those frames alone, so the
 * aligner's clock is the frames' clock the cuts are made on.
 */
async function readRecording(url, source) {
  await patiently(() => download(url, source));
  let bytes = await readFile(source);
  let parsed = mp3Frames(bytes);
  const transcoded = parsed.variable;
  if (transcoded) {
    const total = parsed.frames.reduce((sum, frame) => sum + frame.size, 0);
    await constantBitrate(source, (total * 8) / ((parsed.frames.length * parsed.samples) / parsed.rate));
    bytes = await readFile(source);
    parsed = mp3Frames(bytes);
  }
  if (!parsed.frames.length) throw new Error(`${url} holds no MP3 audio`);
  const audioOnly = `${source}.frames.mp3`;
  await writeFile(audioOnly, Buffer.concat(parsed.frames.map(frame => bytes.subarray(frame.offset, frame.offset + frame.size))));
  const pcm = await decoded(audioOnly).finally(() => rm(audioOnly, { force: true }));
  return { bytes, parsed, transcoded, pcm };
}

/**
 * Where ayahs start that someone has listened for, by reciter and surah:
 * scripts/qf-manual-cuts.json, `{ chapterId: { surah: { ayah: seconds } } }`,
 * for joins neither the aligner nor the Foundation's timings place -- Al-Ajmy's
 * 56 opens with the surah's name and the basmala in another voice.
 */
const manualCuts = (chapterId, surah) => {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'qf-manual-cuts.json'), 'utf8'))[chapterId]?.[surah] ?? null;
  } catch {
    return null;
  }
};

/** The cuts someone listened for put in, each join trusted as it is (`manual`). */
function withManualCuts(placed, manual) {
  // In order, so each is looked for after the one before.
  const entries = Object.entries(manual ?? {}).sort(([a], [b]) => Number(a) - Number(b));
  for (const [key, seconds] of entries) {
    const index = placed.verses.findIndex(verse => verse.ayah === Number(key));
    if (index < 0 || !Number.isFinite(seconds)) continue;
    const after = index > 0 ? placed.cuts[index - 1] + MIN_AYAH_SEC : 0;
    const cut = manualCut({ at: seconds, after, db: placed.db, silences: [] });
    let join = placed.joins.find(join => join.ayah === Number(key) && Boolean(join.opening) === (index === 0));
    if (!join) {
      join = { ayah: Number(key), opening: index === 0 || undefined, index: index || undefined, cut: index };
      placed.joins.push(join);
    }
    Object.assign(join, cut, { manual: true });
    placed.cuts[index] = cut.at;
  }
}

/**
 * Chapter reciters on trial whose first ayah's file keeps the basmala where
 * the cut after it cannot be placed: Al-Ajmy runs his basmala straight into
 * the first ayah, letters said by name included, and neither the aligner nor
 * the Foundation's timings (which start ayah 1 with it) say where it ends.
 */
const BASMALA_WITH_FIRST_AYAH = new Set([19]);

/** Every ayah placed, and why the cut cannot be kept, if it cannot: an ayah no reading placed is a refusal too, kept so it is not tried again for nothing. */
async function placeOrRefuse(pcm, surah, verses, timings, { basmalaWithFirstAyah = false, manual = null } = {}) {
  try {
    const placed = await placeAyahs(pcm, surah, verses, timings);
    withManualCuts(placed, manual);
    const problems = chapterProblems(placed);
    // Where the cut after the opening is all that is wrong, a reciter on trial keeps the opening in the first
    // ayah's file rather than lose the surah (`BASMALA_WITH_FIRST_AYAH`); `checked.basmalaKept` marks it.
    if (basmalaWithFirstAyah && problems.length && placed.joins.some(join => join.opening) &&
      problems.every(problem => problem.startsWith(`the join before ayah ${verses[0].ayah} (`))) {
      placed.joins = placed.joins.filter(join => !join.opening);
      placed.cuts[0] = 0;
      placed.basmalaKept = true;
      return { placed, problems: chapterProblems(placed) };
    }
    return { placed, problems };
  } catch (err) {
    if (!/placed no word/.test(err.message)) throw err;
    return { placed: {}, problems: [err.message] };
  }
}

async function cutChapter(reciter, surah, fresh = null) {
  const folder = dirOf(reciter);
  if (existsSync(chapterFile(folder, surah))) return true;
  if (removedRecitation(keyOf(reciter))) throw new Error(`the Quran Foundation no longer publishes ${reciter.name}`);
  const listing = fresh ?? await patiently(() => chapterRecording(reciter, surah));
  const rejected = await readFile(rejectedFile(folder, surah), 'utf8').then(JSON.parse, () => null);
  if (rejected && !cutStale(rejected, listing)) throw new Error(`not offered ayah by ayah: ${rejected.problems.slice(0, 2).join('; ')}`);
  if (!await aligner()) throw new Error(`cutting it into ayahs needs the alignment service: ${alignerNeeded()}`);
  const dir = path.join(AUDIO, folder);
  await mkdir(dir, { recursive: true });
  const source = path.join(dir, `${pad(surah)}.source.${process.pid}.mp3`);
  try {
    const { bytes, parsed, transcoded, pcm } = await readRecording(listing.file.audio_url, source);
    const verses = await patiently(() => chapterText(surah));
    if (verses.length !== AYAHS[surah - 1]) throw new Error(`QF lists ${verses.length} ayahs of surah ${surah}, not ${AYAHS[surah - 1]}`);
    const timings = listing.ayahs.map(timingOf);
    const sourceInfo = {
      url: listing.file.audio_url, size: Number(listing.file.file_size), updatedAt: listing.file.updated_at, cutAt: new Date().toISOString(),
      transcoded,
    };
    const { placed, problems } = await placeOrRefuse(pcm, surah, verses, timings, {
      basmalaWithFirstAyah: BASMALA_WITH_FIRST_AYAH.has(reciter.chapterId), manual: manualCuts(reciter.chapterId, surah),
    });
    if (problems.length) {
      await writeFile(rejectedFile(folder, surah), JSON.stringify({
        chapterId: reciter.chapterId, surah, source: sourceInfo, problems, joins: placed.joins, windows: placed.windows, openings: placed.openings,
      }, null, 1));
      throw new Error(`not offered ayah by ayah: ${problems.slice(0, 2).join('; ')}${problems.length > 2 ? ` (and ${problems.length - 2} more)` : ''}`);
    }
    await writeFile(chapterFile(folder, surah), JSON.stringify(await writeAyahs({ dir, surah, bytes, parsed, placed, timings, source: sourceInfo })));
    await rm(rejectedFile(folder, surah), { force: true });
    return true;
  } finally {
    await rm(source, { force: true });
  }
}

/** An ayah of letters said by name, timed by the aligner, its first word started with the file (`SEPARATE_LETTERS`). */
const lettersFromStart = (verseKey, byAligner, segments) =>
  (byAligner && SEPARATE_LETTERS.has(verseKey) && segments.length ? [[segments[0][0], 0, segments[0][2]], ...segments.slice(1)] : segments);

/** The ayah files of one cut chapter, written, and the chapter file that lists them. */
async function writeAyahs({ dir, surah, bytes, parsed, placed, timings, source }) {
  const frameOf = seconds => Math.min(parsed.frames.length, frameAt(seconds, parsed.rate, parsed.samples));
  const edges = [...placed.cuts.map(frameOf), parsed.frames.length];
  const useQf = qfWordsFit(placed.joins);
  const qf = new Map(timings.map(timing => [timing.ayah, timing]));
  // An ayah either side of a join the Foundation put in the reciter's voice keeps the aligner's words:
  // its timings there are for another division of the recording (Saad al-Ghamdi recites 23:102 twice,
  // and the Foundation's 23:103 starts at the repeat).
  const misjoined = new Set(placed.joins.filter(join => join.qfInVoice).flatMap(join => [join.ayah - 1, join.ayah]));
  // And the first ayah, where its cut is not the Foundation's: its timings may start it with the basmala
  // (Al-Ajmy's 57:1, its first two words in his basmala, left none in the file).
  if (placed.basmalaKept || placed.joins.some(join => join.opening && !join.qf)) misjoined.add(placed.verses[0].ayah);
  const ayahs = await Promise.all(placed.verses.map(async (verse, i) => {
    const frames = parsed.frames.slice(edges[i], edges[i + 1]);
    const name = `${pad(surah)}${pad(verse.ayah)}.mp3`;
    const partial = path.join(dir, `${name}.${process.pid}.part`);
    await writeFile(partial, Buffer.concat(frames.map(frame => bytes.subarray(frame.offset, frame.offset + frame.size))));
    await rename(partial, path.join(dir, name));
    const ms = framesMs(frames.length, parsed.rate, parsed.samples);
    const fromMs = framesMs(edges[i], parsed.rate, parsed.samples);
    return {
      ayah: verse.ayah,
      file: name,
      ms,
      segments: lettersFromStart(`${surah}:${verse.ayah}`, !useQf || misjoined.has(verse.ayah),
        ayahSegments({ fromMs, ms, qf: useQf && !misjoined.has(verse.ayah) ? qf.get(verse.ayah) : null, words: placed.words.get(verse.ayah) })),
    };
  }));
  const pauses = placed.joins.filter(inPause).length;
  return {
    surah, source, timing: useQf ? 'qf' : 'aligner', ayahs,
    checked: {
      windows: placed.windows.length,
      leastAgreement: Math.min(...placed.windows.map(window => window.agreement)),
      joins: placed.joins.length,
      inPauses: pauses,
      agreedByQf: placed.joins.filter(join => join.qf).length,
      // The ayahs whose join the Foundation's timings put elsewhere; those that are no pause; those confirmed by a second reading.
      qfElsewhere: placed.joins.filter(join => !join.qf).map(join => join.ayah),
      notPauses: placed.joins.filter(join => !inPause(join)).map(join => join.ayah),
      readTwice: placed.joins.filter(join => join.confirmed).map(join => join.ayah),
      movedToQf: placed.joins.filter(join => join.recutAtQf).map(join => join.ayah),
      movedByPair: placed.joins.filter(join => join.movedByPair).map(join => join.ayah),
      basmalaKept: Boolean(placed.basmalaKept),
      manual: placed.joins.filter(join => join.manual).map(join => join.ayah),
      judged: placed.joins.filter(join => join.judged).map(join => join.ayah),
      qfInVoice: placed.joins.filter(join => join.qfInVoice).map(join => join.ayah),
    },
  };
}

// -- Content Sync ---------------------------------------------------------------------------------------------------

const SYNC_STATE = path.join(AUDIO, 'sync.json');
const SYNC_LOCK = path.join(AUDIO, 'sync.lock');

/** `{ reciters: { [qfId]: { token, syncedAt, removed?, lastError? } } }`, kept beside the recordings. */
function readSyncState() {
  try {
    const state = JSON.parse(readFileSync(SYNC_STATE, 'utf8'));
    return state && typeof state.reciters === 'object' ? state : { reciters: {} };
  } catch {
    return { reciters: {} };
  }
}

async function writeSyncState(state) {
  await mkdir(AUDIO, { recursive: true });
  const partial = `${SYNC_STATE}.${process.pid}.part`;
  await writeFile(partial, `${JSON.stringify(state, null, 2)}\n`);
  await rename(partial, SYNC_STATE);
}

const removedRecitation = qfId => Boolean(readSyncState().reciters[qfId]?.removed);

/** A Content Sync path from QF itself: there is no open equivalent, so the client id and secret are needed. */
async function foundationApi(pathAndQuery, timeoutMs = 60_000) {
  const qf = foundation();
  if (!qf) throw new Error('Content Sync needs QURAN_FOUNDATION_CLIENT_ID and QURAN_FOUNDATION_CLIENT_SECRET in .env.local');
  const auth = await foundationToken(qf);
  if (!auth) throw new Error('the Quran Foundation refused the keys');
  const res = await fetchAllowed(`${qf.content}${pathAndQuery}`, {
    headers: { 'x-auth-token': auth, 'x-client-id': qf.id, Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${pathAndQuery.split('?')[0]} answered ${res.status}`);
  return res.json();
}

/** Every change to `resource` (`recitations:<id>`, `chapter_recitations:<id>`) since `token` (all of it when there is none), and the token to ask from next. */
async function recitationChanges(resource, token) {
  return changesFrom(`/resources/sync?resources=${resource}&per_page=100` +
    (token ? `&sync_token=${encodeURIComponent(token)}` : '&bootstrap=true'));
}

/** One page of changes and every page after it; the token comes on the last. */
async function changesFrom(page) {
  const { sync } = await foundationApi(page);
  const mutations = sync?.mutations ?? [];
  if (!sync?.has_more) return { mutations, token: sync?.next_sync_token ?? null };
  const next = apiPath(sync.next_page_url);
  if (!next) throw new Error(`unexpected next page ${sync.next_page_url}`);
  const rest = await changesFrom(next);
  return { mutations: [...mutations, ...rest.mutations], token: rest.token };
}

/** The stitched passages made from one reciter's surah, which a changed or removed chapter makes stale. */
async function removePassages(reciterId, surah = null) {
  const dir = path.join(AUDIO, 'passages');
  const prefix = surah === null ? `${reciterId}-` : `${reciterId}-${pad(surah)}-`;
  const names = await readdir(dir).catch(() => []);
  await Promise.all(names.filter(name => name.startsWith(prefix)).map(name => rm(path.join(dir, name), { force: true })));
}

/** How long files without a chapter file are taken for a download in progress. */
const UNFINISHED_GRACE_MS = 24 * 60 * 60 * 1000;

/** When the newest of one surah's ayah files was written. */
async function newestFileMs(dir, names, surah) {
  const files = names.filter(name => name.startsWith(pad(surah)) && name.endsWith('.mp3'));
  const times = await Promise.all(files.map(name => stat(path.join(dir, name)).then(info => info.mtimeMs, () => 0)));
  return Math.max(0, ...times);
}

/** One surah's files and chapter file, gone. */
async function removeChapter(folder, surah, names) {
  const dir = path.join(AUDIO, String(folder));
  await rm(chapterFile(folder, surah), { force: true });
  await Promise.all(names.filter(name => name.startsWith(pad(surah)) && name.endsWith('.mp3'))
    .map(name => rm(path.join(dir, name), { force: true })));
}

/**
 * What is on disk for one reciter, brought in line with its snapshot: a
 * chapter that changed is fetched again from the snapshot's files, one QF no
 * longer lists is removed, and files left by a download that never finished
 * (no chapter file) are removed rather than kept unsynced. The rest gain the
 * snapshot's addresses and change times. Returns the surahs fetched again.
 */
async function reconcile(reciter, records) {
  const names = await readdir(path.join(AUDIO, String(reciter.qfId))).catch(() => []);
  const bySurah = recordsBySurah(records);
  const onDisk = new Set(names.filter(name => /^\d{6}\.mp3$/.test(name) || /^\d{3}\.json$/.test(name)).map(name => Number(name.slice(0, 3))));
  const refreshed = [];
  await inParallel([...onDisk].sort((a, b) => a - b), async surah => {
    if (await reconcileChapter(reciter, surah, bySurah.get(surah), names)) refreshed.push(surah);
  }, CHAPTERS_AT_ONCE);
  return refreshed.sort((a, b) => a - b);
}

/** One surah of `reconcile`; true when it was fetched again. */
async function reconcileChapter(reciter, surah, fresh, names) {
  const { qfId } = reciter;
  const file = chapterFile(qfId, surah);
  // Files with no chapter file yet may be a download still running (the
  // studio fetches a surah on first use): left for the next sync unless a day old.
  if (!existsSync(file) && await newestFileMs(path.join(AUDIO, String(qfId)), names, surah) > Date.now() - UNFINISHED_GRACE_MS) return false;
  if (!existsSync(file) || !fresh) {
    await removeChapter(qfId, surah, names);
    await removePassages(reciter.id, surah);
    return false;
  }
  const chapter = JSON.parse(await readFile(file, 'utf8'));
  if (chapterStale(chapter, fresh, (await stat(file)).mtimeMs)) {
    await removeChapter(qfId, surah, names);
    await removePassages(reciter.id, surah);
    await fetchChapter(qfId, surah, fresh);
    return true;
  }
  if (chapter.ayahs.some(ayah => !ayah.url)) {
    // Written whole and swapped in: the studio may be reading it.
    const partial = `${file}.${process.pid}.part`;
    await writeFile(partial, JSON.stringify(withSources(chapter, fresh)));
    await rename(partial, file);
  }
  return false;
}

/** A reciter's Content Sync resource and snapshot: a recitation of ayah files, or a chapter recitation. */
const resourceOf = reciter => (reciter.chapterId
  ? { name: `chapter_recitations:${reciter.chapterId}`, snapshot: `/resources/snapshots/chapter_recitations/${reciter.chapterId}` }
  : { name: `recitations:${reciter.qfId}`, snapshot: `/resources/snapshots/recitations/${reciter.qfId}` });

/** One reciter synced; the state entry to keep for it. */
async function syncReciter(reciter, entry) {
  const resource = resourceOf(reciter);
  const { mutations, token } = await recitationChanges(resource.name, entry?.token);
  const plan = mutationPlan(mutations);
  const syncedAt = new Date().toISOString();
  if (plan.deleted) {
    await rm(path.join(AUDIO, dirOf(reciter)), { recursive: true, force: true });
    await removePassages(reciter.id);
    return { entry: { token, syncedAt, removed: true }, note: 'no longer published by the Quran Foundation: its recordings were removed' };
  }
  if (!plan.snapshot) return { entry: { token, syncedAt }, note: 'up to date' };
  const snapshot = await foundationApi(resource.snapshot, 300_000);
  const refreshed = reciter.chapterId ? await reconcileCuts(reciter, snapshot.records) : await reconcile(reciter, snapshot.records);
  return {
    entry: { token, syncedAt },
    note: refreshed.length ? `${refreshed.length} surah(s) fetched again: ${refreshed.join(', ')}` : 'up to date',
  };
}

/**
 * `reconcile` for a chapter reciter: a surah whose recording or timings
 * changed since it was cut is cut again from the snapshot's, one QF no longer
 * lists is removed, and a rejection the change may undo is tried again.
 */
async function reconcileCuts(reciter, records) {
  const folder = dirOf(reciter);
  const names = await readdir(path.join(AUDIO, folder)).catch(() => []);
  const bySurah = chapterRecordsBySurah(records);
  const onDisk = new Set(names.filter(name => /^\d{6}\.mp3$/.test(name) || /^\d{3}\.(rejected\.)?json$/.test(name)).map(name => Number(name.slice(0, 3))));
  const refreshed = [];
  await inParallel([...onDisk].sort((a, b) => a - b), async surah => {
    const fresh = bySurah.get(surah);
    const file = existsSync(chapterFile(folder, surah)) ? chapterFile(folder, surah) : rejectedFile(folder, surah);
    const kept = await readFile(file, 'utf8').then(JSON.parse, () => null);
    if (kept && fresh?.file && !cutStale(kept, fresh)) return;
    // A cut still being made has no chapter file yet: left for the next sync unless a day old.
    if (!kept && await newestFileMs(path.join(AUDIO, folder), names, surah) > Date.now() - UNFINISHED_GRACE_MS) return;
    await removeChapter(folder, surah, names);
    await rm(rejectedFile(folder, surah), { force: true });
    await removePassages(reciter.id, surah);
    if (!kept || !fresh?.file) return;
    await cutChapter(reciter, surah, fresh).then(() => refreshed.push(surah), err => console.error(`  ${reciter.name}, surah ${surah}: ${err.message}`));
  }, 1);
  return refreshed.sort((a, b) => a - b);
}

/** The process holding the sync lock, or 0 when the lock is gone or unreadable. */
function lockHolder() {
  try {
    return Number(readFileSync(SYNC_LOCK, 'utf8')) || 0;
  } catch {
    return 0;
  }
}

/** Whether process `pid` is running (one this user may not signal still is). */
function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Held while a sync runs, so start.sh and the studio's server never run two at once. Null when one already is. */
function takeSyncLock(attempt = 1) {
  try {
    const fd = openSync(SYNC_LOCK, 'wx');
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return () => rmSync(SYNC_LOCK, { force: true });
  } catch (err) {
    if (attempt > 2) throw err;
    const holder = lockHolder();
    if (holder && running(holder)) return null;
    // Left behind by a sync that did not finish, or released between the two calls.
    rmSync(SYNC_LOCK, { force: true });
    return takeSyncLock(attempt + 1);
  }
}

async function syncCommand(args) {
  const quiet = args.includes('--quiet');
  const say = line => { if (!quiet) console.log(line); };
  await mkdir(AUDIO, { recursive: true });
  const state = readSyncState();
  const onDisk = await Promise.all(allReciters().map(async reciter =>
    ((await readdir(path.join(AUDIO, dirOf(reciter))).catch(() => [])).length ? reciter : null)));
  const due = onDisk.filter(Boolean).filter(reciter =>
    !state.reciters[keyOf(reciter)]?.removed && (!args.includes('--if-due') || syncDue(state.reciters[keyOf(reciter)])));
  if (!due.length) {
    say('  nothing due: every recitation on this machine was synced in the last six days');
    return;
  }
  const release = takeSyncLock();
  if (!release) {
    say('  a sync is already running');
    return;
  }
  let failed = 0;
  try {
    // One reciter at a time: each may fetch whole surahs again.
    await inParallel(due, async reciter => {
      try {
        const { entry, note } = await syncReciter(reciter, state.reciters[keyOf(reciter)]);
        state.reciters[keyOf(reciter)] = entry;
        say(`  ${reciter.name}: ${note}`);
      } catch (err) {
        failed++;
        // Kept as it was: unreachable is not changed, and the next run tries again.
        state.reciters[keyOf(reciter)] = { ...state.reciters[keyOf(reciter)], lastError: err.message };
        console.error(`  ${reciter.name}: could not sync (${err.message})`);
      }
      await writeSyncState(state);
    }, 1);
  } finally {
    release();
  }
  process.exitCode = failed ? 1 : 0;
}

/** One line for start.sh, read just before it starts a due sync: when the recordings on disk were last synced. */
async function syncedCommand() {
  const state = readSyncState();
  const onDisk = (await Promise.all(allReciters().map(async reciter =>
    ((await readdir(path.join(AUDIO, dirOf(reciter))).catch(() => [])).length ? reciter : null)))).filter(Boolean);
  if (!onDisk.length) {
    console.log('nothing on disk to sync');
    return;
  }
  const times = onDisk.map(reciter => Date.parse(state.reciters[keyOf(reciter)]?.syncedAt ?? ''));
  const due = onDisk.some(reciter => !state.reciters[keyOf(reciter)]?.removed && syncDue(state.reciters[keyOf(reciter)]));
  const then = due ? '; due, syncing in the background (log in .run/qf-sync.log)' : '';
  if (times.some(at => !Number.isFinite(at))) {
    console.log(`not yet synced with the Quran Foundation${then}`);
    return;
  }
  const days = Math.floor((Date.now() - Math.min(...times)) / (24 * 60 * 60 * 1000));
  console.log(`synced with the Quran Foundation ${days === 0 ? 'today' : days === 1 ? 'a day ago' : `${days} days ago`}${then}`);
}

// -- Cutting ahead of time -----------------------------------------------------------------------------------------

/**
 * `cut` cuts chapter reciters' surahs before anyone loads them, one surah at a
 * time and in the background (./cut_reciters), so no first load waits on the
 * aligner. It shares the GPU with the rest of the machine: after each aligner
 * call it rests long enough that the aligner is busy only `--share` percent of
 * the time, and it can be paused (it waits before its next call, losing
 * nothing) or stopped (the surah in hand is given up; a surah is only ever
 * kept whole). Run again, it carries on where it stopped: a surah cut is skipped.
 */
const CUT_PAUSE = path.join(AUDIO, 'cut.pause');
const CUT_STOP = path.join(AUDIO, 'cut.stop');
const CUT_PID = path.join(AUDIO, 'cut.pid');
/** How much of the time the aligner is busy cutting: set only by `cut`; the studio's own first loads go at full speed. */
let alignerShare = 1;
/** Whether this process is the `cut` run, the only one its pause and stop apply to. */
let cutRun = false;

class CutStopped extends Error {}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Waits while `cut` is paused, or while another program is using the GPU
 * hard, and gives up the surah in hand when it is stopped.
 */
async function whilePaused() {
  if (!cutRun) return;
  if (existsSync(CUT_STOP)) throw new CutStopped('stopped');
  const busy = !existsSync(CUT_PAUSE) && await othersOnGpu() >= OTHERS_BUSY_PCT;
  if (!existsSync(CUT_PAUSE) && !busy) return;
  await sleep(busy ? 15_000 : 3000);
  await whilePaused();
}

/**
 * How much of the GPU other programs are using, percent, from `nvidia-smi
 * pmon`: everything but the aligners (Python), so a game or a video export
 * on this machine makes the cutting wait. Read at most every 10 s; 0 where
 * there is no NVIDIA tool to ask.
 */
const OTHERS_BUSY_PCT = 25;
let gpuReading = { at: 0, others: 0 };
async function othersOnGpu() {
  if (Date.now() - gpuReading.at < 10_000) return gpuReading.others;
  const { stdout } = await execFileAsync('nvidia-smi', ['pmon', '-c', '1', '-s', 'u'], { timeout: 15_000 }).catch(() => ({ stdout: '' }));
  const others = stdout.split('\n').filter(line => line.trim() && !line.startsWith('#'))
    .map(line => line.trim().split(/\s+/))
    .filter(cells => !/^python/.test(cells.at(-1) ?? '') && !/^python/.test(cells[9] ?? ''))
    .reduce((sum, cells) => sum + (Number(cells[3]) || 0), 0);
  if ((others >= OTHERS_BUSY_PCT) !== (gpuReading.others >= OTHERS_BUSY_PCT)) {
    console.log(`${new Date().toLocaleTimeString()}  ${others >= OTHERS_BUSY_PCT ? `another program is using the GPU (${others}%): waiting` : 'the GPU is free again: carrying on'}`);
  }
  gpuReading = { at: Date.now(), others };
  return others;
}

/** After an aligner call of `busyMs`, the rest that keeps it busy only `alignerShare` of the time. */
async function giveWay(busyMs) {
  if (alignerShare < 1) await sleep(busyMs * (1 / alignerShare - 1));
}

/** Surahs cut, refused and left, for one chapter reciter. */
async function cutProgress(reciter) {
  const names = await readdir(path.join(AUDIO, dirOf(reciter))).catch(() => []);
  const cut = names.filter(name => /^\d{3}\.json$/.test(name)).length;
  const refused = names.filter(name => /^\d{3}\.rejected\.json$/.test(name)).map(name => Number(name.slice(0, 3)));
  return { cut, refused, left: 114 - cut - refused.length };
}

const stamp = () => new Date().toLocaleTimeString();

/** One surah of `cut`, on whichever of its aligners is `free`, unless it is cut, refused, or the run stopped. */
async function cutOne({ reciter, surah }, free) {
  if (existsSync(CUT_STOP)) return;
  const folder = dirOf(reciter);
  if (existsSync(chapterFile(folder, surah)) || existsSync(rejectedFile(folder, surah))) return;
  const started = Date.now();
  const url = free.shift();
  try {
    await workerAligner.run(url, () => cutChapter(reciter, surah));
    console.log(`${stamp()}  ${reciter.name}, surah ${surah}: cut in ${Math.round((Date.now() - started) / 60_000)} min`);
  } catch (err) {
    if (!(err instanceof CutStopped)) console.log(`${stamp()}  ${reciter.name}, surah ${surah}: ${err.message}`);
  } finally {
    free.push(url);
  }
}

async function cutCommand(args) {
  const reciters = chosenReciters(args).filter(reciter => reciter.chapterId);
  if (!option(args, '--reciter') || !reciters.length) {
    console.error('  name the chapter reciters to cut: --reciter qfc-159,qfc-13 (see cut-status)');
    process.exitCode = 2;
    return;
  }
  const share = Math.min(100, Math.max(5, Number(option(args, '--share')) || 50));
  alignerShare = share / 100;
  cutRun = true;
  // Each worker its own aligner: one aligner reads one window at a time, so more workers need more of them.
  const aligners = (option(args, '--aligners') || asr()).split(',').map(url => url.trim()).filter(Boolean);
  const up = await Promise.all(aligners.map(url => workerAligner.run(url, aligner)));
  if (!aligners.length || up.includes(false)) {
    console.error(`  the alignment service is needed: ${aligners.filter((_, i) => !up[i]).join(', ') || alignerNeeded()} not answering`);
    process.exitCode = 1;
    return;
  }
  const free = [...aligners];
  await mkdir(AUDIO, { recursive: true });
  await writeFile(CUT_PID, String(process.pid));
  await rm(CUT_STOP, { force: true });
  console.log(`${stamp()}  cutting ${reciters.map(r => r.name).join(', ')}: ${aligners.length} surah(s) at a time, ` +
    `each aligner busy at most ${share}% of the time, waiting while another program uses the GPU`);
  try {
    // In surah order, reciter by reciter, one surah per aligner at a time.
    const jobs = reciters.flatMap(reciter => AYAHS.map((_, i) => ({ reciter, surah: i + 1 })));
    await inParallel(jobs, job => cutOne(job, free), aligners.length);
  } finally {
    await rm(CUT_PID, { force: true });
  }
  const stopped = existsSync(CUT_STOP);
  await rm(CUT_STOP, { force: true });
  console.log(`${stamp()}  ${stopped ? 'stopped; run it again to carry on' : 'done'}`);
  await cutStatusCommand();
}

/** Each chapter reciter's surahs cut, refused and left, and whether a `cut` is running or paused. */
async function cutStatusCommand() {
  const pid = existsSync(CUT_PID) ? Number(readFileSync(CUT_PID, 'utf8')) : 0;
  const state = !pid || !running(pid) ? 'not running'
    : existsSync(CUT_PAUSE) ? `paused (process ${pid})`
    : await othersOnGpu() >= OTHERS_BUSY_PCT ? `waiting while another program uses the GPU (process ${pid})`
    : `running (process ${pid})`;
  console.log(`  cutting ahead of time: ${state}`);
  const reciters = allReciters().filter(reciter => reciter.chapterId);
  const progress = await Promise.all(reciters.map(cutProgress));
  reciters.forEach((reciter, i) => {
    const { cut, refused, left } = progress[i];
    const note = refused.length ? `, ${refused.length} refused (${refused.join(', ')})` : '';
    console.log(`  ${String(i + 1).padStart(2)}) ${reciter.id.padEnd(8)} ${reciter.name.padEnd(24)} ${String(cut).padStart(3)}/114 cut${note}${left ? `, ${left} left` : ''}`);
  });
}

// -- Commands -------------------------------------------------------------------------------------------------------

function option(args, name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

function chosenReciters(args) {
  const wanted = option(args, '--reciter');
  const all = allReciters();
  if (!wanted) return all;
  const names = wanted.split(',').map(s => s.trim());
  return all.filter(r => names.includes(r.id) || (r.qfId && names.includes(String(r.qfId))));
}

async function chaptersOnDisk(reciter) {
  try {
    return (await readdir(path.join(AUDIO, dirOf(reciter)))).filter(name => /^\d{3}\.json$/.test(name)).length;
  } catch {
    return 0;
  }
}

async function downloadCommand(args) {
  const surahs = option(args, '--surah') ? [Number(option(args, '--surah'))] : AYAHS.map((_, i) => i + 1);
  const quiet = args.includes('--quiet');
  let reciters = chosenReciters(args);
  if (reciters.some(reciter => reciter.chapterId) && !await aligner()) {
    // Said once, not once a surah: a chapter recording is cut by the aligner, so without it nothing can be.
    console.error(`  the chapter reciters are cut into ayahs by the alignment service: ${alignerNeeded()} -- skipped`);
    process.exitCode = 1;
    reciters = reciters.filter(reciter => !reciter.chapterId);
  }
  const started = Date.now();
  let failed = 0;
  const jobs = reciters.flatMap(reciter => surahs.map(surah => ({ reciter, surah })));
  await inParallel(jobs, async ({ reciter, surah }) => {
    try {
      await fetchSurah(reciter, surah);
    } catch (err) {
      failed++;
      console.error(`  ${reciter.name}, surah ${surah}: ${err.message}`);
    }
  }, CHAPTERS_AT_ONCE);
  if (!quiet) {
    const counts = await Promise.all(reciters.map(chaptersOnDisk));
    reciters.forEach((reciter, i) => console.log(`  ${reciter.name}: ${counts[i]}/114 surahs`));
    console.log(`  (${Math.round((Date.now() - started) / 1000)}s)`);
  }
  process.exitCode = failed || process.exitCode ? 1 : 0;
}

async function statusCommand() {
  const catalog = allReciters();
  const counts = await Promise.all(catalog.map(chaptersOnDisk));
  catalog.forEach((reciter, i) => console.log(`  ${counts[i] === 114 ? 'ok  ' : 'part'} ${reciter.name}: ${counts[i]}/114 surahs`));
  console.log(`  ${counts.filter(done => done === 114).length}/${catalog.length} reciters fully on this machine, in ${AUDIO}`);
}

/** `<complete reciters> <offered reciters> <surahs on disk> <folder>`, for install.sh and start.sh to read. */
async function countsCommand() {
  const catalog = allReciters();
  const counts = await Promise.all(catalog.map(chaptersOnDisk));
  console.log(`${counts.filter(done => done === 114).length} ${catalog.length} ${counts.reduce((a, b) => a + b, 0)} ${AUDIO}`);
}

async function checkCommand() {
  try {
    const fresh = [...await newRecitations(10_000), ...await newChapterReciters(10_000)];
    if (!fresh.length) console.log('none new on the Quran Foundation');
    else console.log(`${fresh.length} new on the Quran Foundation: ${fresh.map(r => r.name).join(', ')} -- add with ./add_new_reciters`);
  } catch (err) {
    console.log(`could not ask the Quran Foundation (${err.message})`);
  }
}

/** `add`'s arguments: recitation ids (`12`) and chapter-reciter ids (`c159`). */
async function addCommand(args) {
  const ids = args.filter(a => /^\d+$/.test(a)).map(Number);
  const chapterIds = args.filter(a => /^c\d+$/.test(a)).map(a => Number(a.slice(1)));
  const named = ids.length || chapterIds.length;
  const fresh = (await newRecitations(30_000)).filter(r => !named || ids.includes(r.qfId));
  const freshChapters = (await newChapterReciters(30_000)).filter(r => !named || chapterIds.includes(r.chapterId));
  if (!fresh.length && !freshChapters.length) {
    console.log(named ? 'None of those is a new recitation (already offered, excluded, or not on QF).' : 'No new recitations on the Quran Foundation.');
    return;
  }
  const catalog = readCatalog();
  for (const r of fresh) {
    catalog.reciters.push({ id: `qf-${r.qfId}`, qfId: r.qfId, name: r.name, arabicName: r.arabicName, style: r.style });
    console.log(`  added ${r.name} (qf-${r.qfId})`);
  }
  for (const r of freshChapters) {
    (catalog.chapterReciters ??= []).push({ id: `qfc-${r.chapterId}`, chapterId: r.chapterId, name: r.name, arabicName: r.arabicName, style: r.style });
    console.log(`  added ${r.name} (qfc-${r.chapterId}), cut from its chapter recordings`);
  }
  writeCatalog(catalog);
  const chosen = [...fresh.map(r => `qf-${r.qfId}`), ...freshChapters.map(r => `qfc-${r.chapterId}`)];
  if (!args.includes('--no-download')) await downloadCommand(['--reciter', chosen.join(',')]);
  console.log('Rebuild and restart the studio (./stop.sh && ./start.sh) to offer them, and commit src/lib/qfReciters.json.');
}

loadEnv();
const [command, ...args] = process.argv.slice(2);
const commands = {
  download: downloadCommand, status: statusCommand, counts: countsCommand, check: checkCommand, add: addCommand,
  sync: syncCommand, synced: syncedCommand, cut: cutCommand, 'cut-status': cutStatusCommand,
};
if (!commands[command]) {
  console.log('Usage: node scripts/qf-reciters.mjs download|status|check|add|sync|synced|cut|cut-status [...]');
  process.exitCode = 2;
} else {
  await commands[command](args);
}
