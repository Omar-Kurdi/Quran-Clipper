#!/usr/bin/env node
/**
 * The Quran text saved projects are checked against, kept on this machine
 * through the Quran Foundation's Content Sync.
 *
 *   node scripts/qf-text.mjs sync [--if-due] [--quiet] [--add 85,158]   bring the store up to date, adding editions
 *   node scripts/qf-text.mjs status                                     what is held and when each part was synced
 *
 * QF's Developer Terms let content be kept past a week only when it is
 * obtained and maintained through Content Sync, synced at least every seven
 * days. Saved projects keep the Arabic, word glosses, mushaf glyphs and
 * translations they were made with, and are checked against the current text
 * every week (src/lib/contentSync.ts); with the client id and secret set, that
 * current text is read from this store (src/lib/qfTextStore.ts) rather than
 * from the ordinary API.
 *
 * Held, each as its own Content Sync resource with its own token:
 *   quran_core:1                     the verse text and the word list
 *   mushafs:1                        QCF V2, each word's page glyph, page and line
 *   mushafs:4                        Uthmani Hafs, each word's own spelling, which the verse's is paired to
 *   word_by_word_translations:59     the English word glosses
 *   translations:<id>                each edition a project uses (20 always), added on first use
 *   translations:*                   only the list of editions served, which decides deletion
 *
 * Kept in ~/.local/share/quran-clipper/qf-text/ (QC_QF_TEXT_DIR to move it),
 * outside the checkout, which `next build` reads whole, one small file a surah
 * for each resource, so a check never reads a whole snapshot. The studio's
 * server runs a due sync every six hours (src/lib/recitationSync.ts), and so
 * does start.sh.
 */

import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiPath, mutationPlan, syncDue } from './qf-sync-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE = process.env.QC_QF_TEXT_DIR ||
  path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'quran-clipper', 'qf-text');
const USER_AGENT = 'Quran-Clipper (+https://github.com/Omar-Kurdi/Quran-Clipper)';
const STATE = path.join(STORE, 'sync.json');
const LOCK = path.join(STORE, 'sync.lock');

export const CORE = 'quran_core:1';
export const MUSHAF = 'mushafs:1';
export const SPELLING = 'mushafs:4';
export const GLOSSES = 'word_by_word_translations:59';
export const EDITIONS = 'translations:*';
/** Held whatever a project uses: the caption's own translation unless an installation names another. */
const ALWAYS_HELD = ['20'];

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
  return { id, secret, prelive: (process.env.QURAN_FOUNDATION_ENV || 'live').trim().toLowerCase() === 'prelive' };
}

let token = null;

async function foundationToken(qf) {
  if (token && token.until > Date.now()) return token.value;
  // Only the Foundation's own hosts, written out: nothing an answer names is fetched.
  const res = await fetch(qf.prelive ? 'https://prelive-oauth2.quran.foundation/oauth2/token' : 'https://oauth2.quran.foundation/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${qf.id}:${qf.secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials&scope=content',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error('the Quran Foundation refused the keys');
  const data = await res.json();
  token = { value: data.access_token, until: Date.now() + ((data.expires_in || 3600) - 120) * 1000 };
  return token.value;
}

async function foundationApi(pathAndQuery, timeoutMs = 60_000) {
  const qf = foundation();
  if (!qf) throw new Error('Content Sync needs QURAN_FOUNDATION_CLIENT_ID and QURAN_FOUNDATION_CLIENT_SECRET in .env.local');
  const res = await fetch(qf.prelive
    ? `https://apis-prelive.quran.foundation/content/api/v4${pathAndQuery}`
    : `https://apis.quran.foundation/content/api/v4${pathAndQuery}`, {
    headers: { 'x-auth-token': await foundationToken(qf), 'x-client-id': qf.id, Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${pathAndQuery.split('?')[0]} answered ${res.status}`);
  return res.json();
}

/** Every change to `resource` since `token` (all of it when there is none), and the token to ask from next. */
async function changes(resource, since) {
  return changesFrom(`/resources/sync?resources=${encodeURIComponent(resource)}&per_page=100` +
    (since ? `&sync_token=${encodeURIComponent(since)}` : '&bootstrap=true'));
}

async function changesFrom(page) {
  const { sync } = await foundationApi(page);
  const mutations = sync?.mutations ?? [];
  if (!sync?.has_more) return { mutations, token: sync?.next_sync_token ?? null };
  const next = apiPath(sync.next_page_url);
  if (!next) throw new Error(`unexpected next page ${sync.next_page_url}`);
  const rest = await changesFrom(next);
  return { mutations: [...mutations, ...rest.mutations], token: rest.token };
}

const snapshotPath = resource => {
  const [group, id] = resource.split(':');
  return `/resources/snapshots/${group}/${id}`;
};

// -- The store ------------------------------------------------------------------------------------------------------

const pad = n => String(n).padStart(3, '0');
/** Where one resource's surah files live: `core`, `mushaf`, `glosses`, `translations/<id>`. */
export function folderOf(resource) {
  if (resource === CORE) return 'core';
  if (resource === MUSHAF) return 'mushaf';
  if (resource === SPELLING) return 'spelling';
  if (resource === GLOSSES) return 'glosses';
  return path.join('translations', resource.split(':')[1]);
}

/** `{ resources: { [resource]: { token, syncedAt, removed?, lastError? } }, editions?: string[] }`. */
function readState() {
  try {
    const state = JSON.parse(readFileSync(STATE, 'utf8'));
    return state && typeof state.resources === 'object' ? state : { resources: {} };
  } catch {
    return { resources: {} };
  }
}

async function writeWhole(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.part`;
  await writeFile(partial, typeof data === 'string' ? data : JSON.stringify(data));
  await rename(partial, file);
}

/** A resource's surah files, replaced as a whole: written beside, then swapped in, so a reader sees one or the other. */
async function replaceFolder(resource, bySurah) {
  const target = path.join(STORE, folderOf(resource));
  const fresh = `${target}.${process.pid}.new`;
  await rm(fresh, { recursive: true, force: true });
  await mkdir(fresh, { recursive: true });
  await Promise.all([...bySurah].map(([surah, data]) => writeFile(path.join(fresh, `${pad(surah)}.json`), JSON.stringify(data))));
  const old = `${target}.${process.pid}.old`;
  if (existsSync(target)) await rename(target, old);
  await rename(fresh, target);
  await rm(old, { recursive: true, force: true });
}

const group = (records, keyOf) => {
  const bySurah = new Map();
  for (const record of records) {
    const surah = keyOf(record);
    if (!Number.isInteger(surah) || surah < 1 || surah > 114) continue;
    bySurah.set(surah, [...(bySurah.get(surah) ?? []), record]);
  }
  return bySurah;
};

/**
 * The surah files of one snapshot. Words are joined to the other resources by
 * word id; `wordSurah` places a word id in its surah for those that do not say.
 */
export function surahFiles(resource, records, wordSurah) {
  if (resource === CORE) {
    const verses = group(records.filter(r => r.record_type === 'verse'), r => Number(r.chapter_id));
    const words = group(records.filter(r => r.record_type === 'word'), r => Number(r.chapter_id));
    return new Map([...verses].map(([surah, list]) => [surah, list
      .sort((a, b) => a.verse_number - b.verse_number)
      .map(verse => ({
        verse_key: verse.verse_key,
        verse_number: verse.verse_number,
        text_uthmani: verse.text_uthmani,
        words: (words.get(surah) ?? []).filter(word => word.verse_id === verse.id)
          .sort((a, b) => a.position - b.position)
          .map(word => ({
            id: word.id, char_type_name: word.char_type_name, text_indopak: word.text_indopak,
          })),
      }))]));
  }
  if (resource === MUSHAF) {
    const words = group(records.filter(r => r.record_type === 'mushaf_word'), r => wordSurah(r.word_id));
    return new Map([...words].map(([surah, list]) =>
      [surah, Object.fromEntries(list.map(word => [word.word_id, [word.text, word.page_number, word.line_number]]))]));
  }
  if (resource === SPELLING) {
    const words = group(records.filter(r => r.record_type === 'mushaf_word'), r => wordSurah(r.word_id));
    return new Map([...words].map(([surah, list]) => [surah, Object.fromEntries(list.map(word => [word.word_id, word.text]))]));
  }
  if (resource === GLOSSES) {
    const words = group(records, r => wordSurah(r.word_id));
    return new Map([...words].map(([surah, list]) => [surah, Object.fromEntries(list.map(gloss => [gloss.word_id, gloss.text]))]));
  }
  const verses = group(records, r => Number(r.chapter_id ?? String(r.verse_key).split(':')[0]));
  return new Map([...verses].map(([surah, list]) => [surah, Object.fromEntries(list.map(verse => [verse.verse_key, verse.text]))]));
}

/** Word id -> surah, from the word list held (QF's word ids are not in the mushaf's order). */
function wordSurahs() {
  const index = JSON.parse(readFileSync(path.join(STORE, 'core', 'index.json'), 'utf8'));
  return wordId => index[wordId] ?? null;
}

async function applySnapshot(resource) {
  const snapshot = await foundationApi(snapshotPath(resource), 600_000);
  const records = snapshot.records ?? [];
  const files = surahFiles(resource, records, resource === CORE ? null : wordSurahs());
  if (resource === CORE && files.size !== 114) throw new Error(`the word list holds ${files.size} surahs, not 114`);
  await replaceFolder(resource, files);
  if (resource === CORE) {
    // Each word id's surah, for `wordSurahs`.
    const index = Object.fromEntries([...files].flatMap(([surah, verses]) => verses.flatMap(v => v.words.map(w => [w.id, surah]))));
    await writeWhole(path.join(STORE, 'core', 'index.json'), index);
  }
}

/** The editions QF serves, kept current from the resource-level changes of `translations:*`; no snapshot is fetched. */
export function editionsAfter(held, mutations) {
  const ids = new Set(held);
  for (const m of [...mutations].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))) {
    if (m.type === 'RESOURCE_CREATE') ids.add(String(m.resource_id));
    if (m.type === 'RESOURCE_DELETE') ids.delete(String(m.resource_id));
  }
  return [...ids].sort((a, b) => Number(a) - Number(b));
}

/** One resource synced; the state entry to keep for it. */
async function syncResource(resource, entry, state) {
  const { mutations, token: next } = await changes(resource, entry?.token);
  const syncedAt = new Date().toISOString();
  if (resource === EDITIONS) {
    state.editions = editionsAfter(entry?.token ? state.editions ?? [] : [], mutations);
    return { token: next, syncedAt };
  }
  const plan = mutationPlan(mutations);
  if (plan.deleted) {
    await rm(path.join(STORE, folderOf(resource)), { recursive: true, force: true });
    return { token: next, syncedAt, removed: true };
  }
  // Anything changed, or nothing held yet: the snapshot replaces what is here.
  const held = existsSync(path.join(STORE, folderOf(resource)));
  if (plan.snapshot || !held) await applySnapshot(resource);
  return { token: next, syncedAt };
}

function lockHolder() {
  try {
    return Number(readFileSync(LOCK, 'utf8')) || 0;
  } catch {
    return 0;
  }
}

function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Held while a sync runs, so the server and start.sh never run two at once. Null when one already is. */
function takeLock(attempt = 1) {
  try {
    const fd = openSync(LOCK, 'wx');
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return () => rmSync(LOCK, { force: true });
  } catch (err) {
    if (attempt > 2) throw err;
    const holder = lockHolder();
    if (holder && running(holder)) return null;
    rmSync(LOCK, { force: true });
    return takeLock(attempt + 1);
  }
}

const option = (args, name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] ?? '' : '';
};

/** Every resource the store holds or is asked to: the base five, the editions held, and `added`. */
function wanted(state, added) {
  const editions = new Set([...ALWAYS_HELD, ...added]);
  for (const resource of Object.keys(state.resources)) {
    if (resource.startsWith('translations:') && resource !== EDITIONS && !state.resources[resource].removed) editions.add(resource.split(':')[1]);
  }
  // The word list first: the glyphs and glosses are placed in their surahs by it.
  return [CORE, MUSHAF, SPELLING, GLOSSES, EDITIONS, ...[...editions].sort((a, b) => Number(a) - Number(b)).map(id => `translations:${id}`)];
}

async function syncCommand(args) {
  const quiet = args.includes('--quiet');
  const say = line => { if (!quiet) console.log(line); };
  if (!foundation()) {
    say('  no Quran Foundation keys: saved projects are checked against the open API instead');
    return;
  }
  await mkdir(STORE, { recursive: true });
  const added = option(args, '--add').split(',').map(id => id.trim()).filter(id => /^\d+$/.test(id));
  const state = readState();
  const due = wanted(state, added).filter(resource => !state.resources[resource] || state.resources[resource].lastError ||
    (!state.resources[resource].removed && (!args.includes('--if-due') || syncDue(state.resources[resource]))));
  if (!due.length) {
    say('  nothing due: the text was synced in the last six days');
    return;
  }
  const release = takeLock();
  if (!release) {
    say('  a text sync is already running');
    return;
  }
  try {
    process.exitCode = await syncInTurn(due, state, say) ? 1 : 0;
  } finally {
    release();
  }
}

/**
 * `resources` synced one after another, in order -- the glyphs and glosses
 * are placed in their surahs by the word list synced before them -- each
 * kept in the state as it finishes. Returns how many failed.
 */
async function syncInTurn([resource, ...rest], state, say) {
  if (!resource) return 0;
  let failed = 0;
  try {
    state.resources[resource] = await syncResource(resource, state.resources[resource], state);
    say(`  ${resource}: ${state.resources[resource].removed ? 'no longer published: removed' : 'up to date'}`);
  } catch (err) {
    failed = 1;
    // Kept as it was: unreachable is not changed, and the next run tries again.
    state.resources[resource] = { ...state.resources[resource], lastError: err.message };
    console.error(`  ${resource}: could not sync (${err.message})`);
  }
  await writeWhole(STATE, `${JSON.stringify(state, null, 2)}\n`);
  return failed + await syncInTurn(rest, state, say);
}

function statusCommand() {
  const state = readState();
  const resources = Object.entries(state.resources);
  if (!resources.length) console.log('  nothing held yet');
  for (const [resource, entry] of resources) {
    console.log(`  ${resource}: ${entry.removed ? 'removed' : `synced ${entry.syncedAt ?? 'never'}`}${entry.lastError ? `, last error: ${entry.lastError}` : ''}`);
  }
  if (state.editions) console.log(`  editions served: ${state.editions.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnv();
  const [command, ...args] = process.argv.slice(2);
  if (command === 'sync') await syncCommand(args);
  else if (command === 'status') statusCommand();
  else {
    console.error('usage: node scripts/qf-text.mjs sync [--if-due] [--quiet] [--add 85,158] | status');
    process.exitCode = 2;
  }
}
