#!/usr/bin/env node
/**
 * Watches the copy of The Clear Quran in `data/quran/`.
 *
 * The text is served from a file on this machine because quran.com only
 * publishes Khattab's translation through the Quran Foundation API, and the
 * credentials here reach the pre-live sandbox. See `src/lib/clearQuran.ts`.
 *
 * What this is *not* for: re-applying the repairs. Those live in
 * `normaliseClearQuran` and run every time an ayah is read, on whatever the
 * file happens to contain -- the file itself is byte-for-byte what the server
 * served. A newer download is therefore repaired identically with nobody
 * present, and there is nothing to merge or pick out by hand.
 *
 * What it *is* for: a newer version could carry damage the repair table has
 * never seen, and nobody would notice until a tofu box appeared in an exported
 * video. So an update is audited before it is accepted, against the inventory
 * of the copy already in use -- anything spelled with a character this edition
 * has never used before is worth a human's attention.
 *
 *   node scripts/clear-quran.mjs check     is there a newer version? (one HEAD request)
 *                                          exits 10 when there is, so a caller
 *                                          can act on it without reading prose
 *   node scripts/clear-quran.mjs update    download it, audit it, accept it if it is clean
 *   node scripts/clear-quran.mjs accept    bless the installed file as the new baseline
 *   node scripts/clear-quran.mjs audit F   audit a file on disk, without the network
 */

import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const SOURCE = 'https://quranapi.pages.dev/api/english.json';
const DIR = path.join(process.cwd(), 'data', 'quran');
const FILE = path.join(DIR, 'english.json');
const ETAG = path.join(DIR, 'english.etag');
const CHARSET = path.join(DIR, 'english.charset.json');
const CANDIDATE = path.join(DIR, 'english.candidate.json');

/** The whole Quran, so a file that has lost a verse is caught rather than served. */
const TOTAL_SURAHS = 114;
const TOTAL_AYAHS = 6236;

/** `check`'s way of saying so without the caller having to match on wording. */
const UPDATE_AVAILABLE = 10;

const read = file => (existsSync(file) ? readFileSync(file, 'utf8').trim() : '');

/** Every codepoint above ASCII in a parsed file, with how often each appears. */
function inventory(surahs) {
  const counts = {};
  for (const surah of surahs) {
    for (const ayah of surah.translation || []) {
      for (const ch of ayah) {
        const code = ch.codePointAt(0);
        if (code > 127) counts[code] = (counts[code] || 0) + 1;
      }
    }
  }
  return counts;
}

const hex = code => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * Everything wrong with a candidate, as a list of complaints.
 *
 * Structure first: a surah whose text no longer matches its own ayah count
 * puts every caption after the gap against the wrong verse, which is both
 * worse than a bad glyph and far harder to notice. The loader refuses such a
 * surah outright, so this and it agree.
 */
function audit(text, baselineCharset) {
  const problems = [];
  let surahs;
  try {
    surahs = JSON.parse(text);
  } catch {
    return { problems: ['not valid JSON'], surahs: null };
  }
  if (!Array.isArray(surahs)) return { problems: ['not an array of surahs'], surahs: null };
  if (surahs.length !== TOTAL_SURAHS) problems.push(`${surahs.length} surahs, expected ${TOTAL_SURAHS}`);

  let ayahs = 0;
  for (const surah of surahs) {
    const list = surah?.translation;
    if (!Array.isArray(list)) { problems.push(`surah ${surah?.surahNo}: no translation`); continue; }
    ayahs += list.length;
    if (surah.totalAyah !== undefined && list.length !== surah.totalAyah) {
      problems.push(`surah ${surah.surahNo}: ${list.length} ayahs of text against totalAyah ${surah.totalAyah}`);
    }
  }
  if (ayahs !== TOTAL_AYAHS) problems.push(`${ayahs} ayahs in total, expected ${TOTAL_AYAHS}`);

  // Characters this edition has not used before. Not necessarily wrong -- but
  // the two mangled letters in the copy we started from looked exactly like
  // this, and no font check runs out here.
  if (baselineCharset) {
    const seen = inventory(surahs);
    const novel = Object.keys(seen)
      .map(Number)
      .filter(code => !baselineCharset.includes(code))
      .sort((a, b) => seen[b] - seen[a]);
    for (const code of novel) {
      problems.push(`new character ${hex(code)} "${String.fromCodePoint(code)}" x${seen[code]} — never used in the copy in use; check it renders before accepting`);
    }
  }

  return { problems, surahs };
}

/** How many ayahs read differently, which is the number worth looking at. */
function changedAyahs(before, after) {
  if (!before) return null;
  const key = surahs => {
    const out = {};
    for (const s of surahs || []) out[s?.surahNo] = s?.translation || [];
    return out;
  };
  const a = key(before);
  const b = key(after);
  let changed = 0;
  for (const surahNo of Object.keys(b)) {
    const oldList = a[surahNo] || [];
    b[surahNo].forEach((text, i) => { if (text !== oldList[i]) changed += 1; });
  }
  return changed;
}

/**
 * The etag, with the weak marker and quotes taken off.
 *
 * The host currently answers `W/"..."` to both HEAD and GET, but whether an
 * etag is weak depends on whether the body was compressed -- so comparing the
 * raw header would one day report an endless stream of new versions that are
 * the same file. Only the hash inside is worth keeping.
 */
const bareEtag = header => (header || '').replace(/^W\//, '').replace(/"/g, '');

/** Three seconds: this runs on every studio start, and it is only ever news. */
const REACH_TIMEOUT_MS = 3000;

/**
 * Bounded by the clock, not only by the request's own signal.
 *
 * `AbortSignal.timeout` does not cover working out where to connect: pointed
 * at an unroutable address this took 10.5 seconds to give up, because the
 * attempts underneath it each have their own patience. Racing a timer puts a
 * real ceiling on it -- which matters because this runs on every `./start.sh`,
 * and a studio that takes ten seconds longer to come up when the wifi is off
 * is a worse thing than not knowing about a translation update.
 */
async function remoteEtag() {
  const controller = new AbortController();
  let timer;
  try {
    const res = await Promise.race([
      fetch(SOURCE, { method: 'HEAD', signal: controller.signal }),
      new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('timed out')); }, REACH_TIMEOUT_MS);
      })
    ]);
    if (!res.ok) throw new Error(`HEAD ${res.status}`);
    return bareEtag(res.headers.get('etag'));
  } finally {
    // Both of them: an uncleared timer holds the event loop open for its full
    // delay after the answer is already known, which turned a 40ms check into
    // a three-second one.
    clearTimeout(timer);
  }
}

function writeBaseline(surahs, etag) {
  const codes = Object.keys(inventory(surahs)).map(Number).sort((x, y) => x - y);
  writeFileSync(CHARSET, JSON.stringify({ source: SOURCE, characters: codes }, null, 2));
  if (etag) writeFileSync(ETAG, etag);
  return codes;
}

const baselineCharset = () => {
  try { return JSON.parse(read(CHARSET)).characters; } catch { return null; }
};

async function check() {
  if (!existsSync(FILE)) { console.log('not installed (see src/lib/clearQuran.ts)'); return; }
  const known = read(ETAG);
  let etag;
  try {
    etag = await remoteEtag();
  } catch {
    // Offline, or the host is down. Neither is a reason to say anything
    // alarming about a file that is sitting right there and working.
    console.log('up to date (could not reach the source to check)');
    return;
  }
  if (!known) { console.log('installed, never checked — run: node scripts/clear-quran.mjs accept'); return; }
  if (etag === known) { console.log('up to date'); return; }
  // Short, because this line is read inside `./start.sh`'s summary. What to do
  // about it is printed there, on its own line, where a command can be copied.
  console.log('a newer version is available');
  return UPDATE_AVAILABLE;
}


async function update() {
  const res = await fetch(SOURCE);
  if (!res.ok) { console.error(`Could not download: HTTP ${res.status}`); process.exit(1); }
  const etag = bareEtag(res.headers.get('etag'));
  const text = await res.text();

  const installed = read(FILE);
  if (installed && text === installed) {
    console.log('Identical to the copy already installed. Nothing to do.');
    if (etag) writeFileSync(ETAG, etag);
    return;
  }

  const { problems, surahs } = audit(text, baselineCharset());
  let before = null;
  try { before = JSON.parse(installed); } catch { /* nothing installed yet */ }
  const changed = surahs ? changedAyahs(before, surahs) : null;

  console.log(`Downloaded ${(text.length / 1e6).toFixed(2)} MB.`);
  if (changed !== null) console.log(`${changed} ayah${changed === 1 ? '' : 's'} read differently from the installed copy.`);

  if (problems.length) {
    writeFileSync(CANDIDATE, text);
    console.log('\nNOT accepted. What needs a look:');
    for (const problem of problems) console.log(`  - ${problem}`);
    console.log(`\nThe download is kept at ${path.relative(process.cwd(), CANDIDATE)}.`);
    console.log('Accept it anyway by moving it over english.json and running: node scripts/clear-quran.mjs accept');
    process.exit(1);
  }

  if (installed) copyFileSync(FILE, `${FILE}.previous`);
  writeFileSync(CANDIDATE, text);
  renameSync(CANDIDATE, FILE);
  writeBaseline(surahs, etag);
  console.log('\nClean: same structure, no characters this edition has not used before. Accepted.');
  if (installed) console.log(`The copy it replaced is at ${path.basename(FILE)}.previous.`);
}

async function accept() {
  const text = read(FILE);
  if (!text) { console.error('Nothing installed to accept.'); process.exit(1); }
  const { problems, surahs } = audit(text, null);
  if (problems.length) {
    console.error('The installed file does not look right:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  // The etag as well, so `check` has something to compare against. Recorded
  // here rather than left for `update` to fill in: a baseline that cannot say
  // when it was taken makes the first check report a new version that is
  // actually the one already installed.
  let etag = '';
  try { etag = await remoteEtag(); } catch { /* offline; `check` will say so */ }
  const codes = writeBaseline(surahs, etag);
  console.log(`Baseline recorded: ${surahs.length} surahs, ${TOTAL_AYAHS} ayahs, ${codes.length} characters above ASCII.`);
  console.log(etag ? 'Current version noted; `check` will now report only genuine updates.' : 'Could not reach the source, so no version was noted — run this again when online.');
}

/** Audits a file already on disk, without going near the network. */
function auditFile() {
  const target = process.argv[3];
  if (!target) { console.error('Usage: node scripts/clear-quran.mjs audit <file>'); process.exit(1); }
  const text = read(target);
  if (!text) { console.error(`Nothing to read at ${target}`); process.exit(1); }
  const { problems, surahs } = audit(text, baselineCharset());
  let before = null;
  try { before = JSON.parse(read(FILE)); } catch { /* nothing installed */ }
  const changed = surahs ? changedAyahs(before, surahs) : null;
  if (changed !== null) console.log(`${changed} ayah${changed === 1 ? '' : 's'} read differently from the installed copy.`);
  if (!problems.length) { console.log('Clean: same structure, no characters this edition has not used before.'); return; }
  console.log('Needs a look:');
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exit(1);
}

const command = process.argv[2] || 'check';
const commands = { check, update, accept, audit: auditFile };
if (!commands[command]) {
  console.error(`Unknown command "${command}". Use: check | update | accept | audit <file>`);
  process.exit(1);
}
const code = await commands[command]();
// Every failing path above has already exited, so reaching here is success --
// except for `check`, which reports a waiting update as a code rather than as
// a failure. Exiting explicitly because an abandoned socket (the offline case)
// keeps the event loop alive long after the answer has been printed, and this
// runs while someone is waiting for the studio to come up.
process.exit(typeof code === 'number' ? code : 0);
