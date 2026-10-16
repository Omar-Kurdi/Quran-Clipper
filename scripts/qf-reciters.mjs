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
 * Reads QF through the client id and secret in `.env.local` when they are set,
 * otherwise through the open api.quran.com, which serves the same recitations.
 *
 * `sync` keeps what is on disk within the Foundation's Developer Terms: stored
 * content may be kept past a week only when it is maintained through their
 * Content Sync APIs, synced at least every seven days. It needs the client id
 * and secret (Content Sync has no open equivalent). start.sh runs it when due,
 * and so does the studio's server every few hours (src/instrumentation.ts).
 */

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

/** fetch(), for an https address on `ALLOWED_HOSTS` only. */
function fetchAllowed(url, init) {
  const { protocol, hostname } = new URL(url);
  if (protocol !== 'https:' || !ALLOWED_HOSTS.has(hostname)) throw new Error(`${hostname} is not a host this script fetches from`);
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

// -- Files ----------------------------------------------------------------------------------------------------------

const pad = n => String(n).padStart(3, '0');
const chapterFile = (qfId, surah) => path.join(AUDIO, String(qfId), `${pad(surah)}.json`);
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

/** Every change to recitation `qfId` since `token` (all of it when there is none), and the token to ask from next. */
async function recitationChanges(qfId, token) {
  return changesFrom(`/resources/sync?resources=recitations:${qfId}&per_page=100` +
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
async function removeChapter(qfId, surah, names) {
  const dir = path.join(AUDIO, String(qfId));
  await rm(chapterFile(qfId, surah), { force: true });
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

/** One reciter synced; the state entry to keep for it. */
async function syncReciter(reciter, entry) {
  const { mutations, token } = await recitationChanges(reciter.qfId, entry?.token);
  const plan = mutationPlan(mutations);
  const syncedAt = new Date().toISOString();
  if (plan.deleted) {
    await rm(path.join(AUDIO, String(reciter.qfId)), { recursive: true, force: true });
    await removePassages(reciter.id);
    return { entry: { token, syncedAt, removed: true }, note: 'no longer published by the Quran Foundation: its recordings were removed' };
  }
  if (!plan.snapshot) return { entry: { token, syncedAt }, note: 'up to date' };
  const snapshot = await foundationApi(`/resources/snapshots/recitations/${reciter.qfId}`, 300_000);
  const refreshed = await reconcile(reciter, snapshot.records);
  return {
    entry: { token, syncedAt },
    note: refreshed.length ? `${refreshed.length} surah(s) fetched again: ${refreshed.join(', ')}` : 'up to date',
  };
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
  const onDisk = await Promise.all(readCatalog().reciters.map(async reciter =>
    ((await readdir(path.join(AUDIO, String(reciter.qfId))).catch(() => [])).length ? reciter : null)));
  const due = onDisk.filter(Boolean).filter(reciter =>
    !state.reciters[reciter.qfId]?.removed && (!args.includes('--if-due') || syncDue(state.reciters[reciter.qfId])));
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
        const { entry, note } = await syncReciter(reciter, state.reciters[reciter.qfId]);
        state.reciters[reciter.qfId] = entry;
        say(`  ${reciter.name}: ${note}`);
      } catch (err) {
        failed++;
        // Kept as it was: unreachable is not changed, and the next run tries again.
        state.reciters[reciter.qfId] = { ...state.reciters[reciter.qfId], lastError: err.message };
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
  const onDisk = (await Promise.all(readCatalog().reciters.map(async reciter =>
    ((await readdir(path.join(AUDIO, String(reciter.qfId))).catch(() => [])).length ? reciter : null)))).filter(Boolean);
  if (!onDisk.length) {
    console.log('nothing on disk to sync');
    return;
  }
  const times = onDisk.map(reciter => Date.parse(state.reciters[reciter.qfId]?.syncedAt ?? ''));
  const due = onDisk.some(reciter => !state.reciters[reciter.qfId]?.removed && syncDue(state.reciters[reciter.qfId]));
  const then = due ? '; due, syncing in the background (log in .run/qf-sync.log)' : '';
  if (times.some(at => !Number.isFinite(at))) {
    console.log(`not yet synced with the Quran Foundation${then}`);
    return;
  }
  const days = Math.floor((Date.now() - Math.min(...times)) / (24 * 60 * 60 * 1000));
  console.log(`synced with the Quran Foundation ${days === 0 ? 'today' : days === 1 ? 'a day ago' : `${days} days ago`}${then}`);
}

// -- Commands -------------------------------------------------------------------------------------------------------

function option(args, name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

function chosenReciters(args) {
  const wanted = option(args, '--reciter');
  const all = readCatalog().reciters;
  if (!wanted) return all;
  const names = wanted.split(',').map(s => s.trim());
  return all.filter(r => names.includes(r.id) || names.includes(String(r.qfId)));
}

async function chaptersOnDisk(qfId) {
  try {
    return (await readdir(path.join(AUDIO, String(qfId)))).filter(name => /^\d{3}\.json$/.test(name)).length;
  } catch {
    return 0;
  }
}

async function downloadCommand(args) {
  const surahs = option(args, '--surah') ? [Number(option(args, '--surah'))] : AYAHS.map((_, i) => i + 1);
  const quiet = args.includes('--quiet');
  const reciters = chosenReciters(args);
  const started = Date.now();
  let failed = 0;
  const jobs = reciters.flatMap(reciter => surahs.map(surah => ({ reciter, surah })));
  await inParallel(jobs, async ({ reciter, surah }) => {
    try {
      await fetchChapter(reciter.qfId, surah);
    } catch (err) {
      failed++;
      console.error(`  ${reciter.name}, surah ${surah}: ${err.message}`);
    }
  }, CHAPTERS_AT_ONCE);
  if (!quiet) {
    const counts = await Promise.all(reciters.map(reciter => chaptersOnDisk(reciter.qfId)));
    reciters.forEach((reciter, i) => console.log(`  ${reciter.name}: ${counts[i]}/114 surahs`));
    console.log(`  (${Math.round((Date.now() - started) / 1000)}s)`);
  }
  process.exitCode = failed ? 1 : 0;
}

async function statusCommand() {
  const catalog = readCatalog().reciters;
  const counts = await Promise.all(catalog.map(reciter => chaptersOnDisk(reciter.qfId)));
  catalog.forEach((reciter, i) => console.log(`  ${counts[i] === 114 ? 'ok  ' : 'part'} ${reciter.name}: ${counts[i]}/114 surahs`));
  console.log(`  ${counts.filter(done => done === 114).length}/${catalog.length} reciters fully on this machine, in ${AUDIO}`);
}

/** `<complete reciters> <offered reciters> <surahs on disk> <folder>`, for install.sh and start.sh to read. */
async function countsCommand() {
  const catalog = readCatalog().reciters;
  const counts = await Promise.all(catalog.map(reciter => chaptersOnDisk(reciter.qfId)));
  console.log(`${counts.filter(done => done === 114).length} ${catalog.length} ${counts.reduce((a, b) => a + b, 0)} ${AUDIO}`);
}

async function checkCommand() {
  try {
    const fresh = await newRecitations(10_000);
    if (!fresh.length) console.log('none new on the Quran Foundation');
    else console.log(`${fresh.length} new on the Quran Foundation: ${fresh.map(r => r.name).join(', ')} -- add with ./add_new_reciters`);
  } catch (err) {
    console.log(`could not ask the Quran Foundation (${err.message})`);
  }
}

async function addCommand(args) {
  const ids = args.filter(a => /^\d+$/.test(a)).map(Number);
  const fresh = await newRecitations(30_000);
  const chosen = ids.length ? fresh.filter(r => ids.includes(r.qfId)) : fresh;
  if (!chosen.length) {
    console.log(ids.length ? 'None of those is a new recitation (already offered, excluded, or not on QF).' : 'No new recitations on the Quran Foundation.');
    return;
  }
  const catalog = readCatalog();
  for (const r of chosen) {
    catalog.reciters.push({ id: `qf-${r.qfId}`, qfId: r.qfId, name: r.name, arabicName: r.arabicName, style: r.style });
    console.log(`  added ${r.name} (qf-${r.qfId})`);
  }
  writeCatalog(catalog);
  if (!args.includes('--no-download')) await downloadCommand(['--reciter', chosen.map(r => r.qfId).join(',')]);
  console.log('Rebuild and restart the studio (./stop.sh && ./start.sh) to offer them, and commit src/lib/qfReciters.json.');
}

loadEnv();
const [command, ...args] = process.argv.slice(2);
const commands = {
  download: downloadCommand, status: statusCommand, counts: countsCommand, check: checkCommand, add: addCommand,
  sync: syncCommand, synced: syncedCommand,
};
if (!commands[command]) {
  console.log('Usage: node scripts/qf-reciters.mjs download|status|check|add|sync|synced [...]');
  process.exitCode = 2;
} else {
  await commands[command](args);
}
