#!/usr/bin/env node
/**
 * Turns the QUL exports in `data/qul/` into the two files the studio reads.
 *
 * QUL has no API -- its downloads sit behind a signed-in account -- so the
 * exports arrive by hand as SQLite databases and a zip. Rather than teach the
 * app to read either at runtime, they are converted once into plain JSON, the
 * same way `data/local-translations/` is simply read with `fs`. That keeps the
 * app free of a database driver and keeps the shapes small enough to hold in
 * memory: the morphology arrives as 6 MB across six databases and leaves as a
 * few hundred kilobytes of what is actually used.
 *
 * Run it after downloading, or after replacing an export with a newer one:
 *
 *   node scripts/qul-import.mjs
 *
 * What it expects in `data/qul/`, all optional -- whatever is missing is
 * skipped with a line saying so:
 *
 *   ayah-root.db, ayah-lemma.db, ayah-stem.db   verse_key -> its roots/lemmas/stems
 *   word-root.db, word-lemma.db, word-stem.db   the roots/lemmas/stems themselves
 *   phrases.json, phrase_verses.json            mutashabihat, from the zip
 *
 *   fonts/                                      the mushaf fonts, as QUL packs
 *                                               them. Unpacked into
 *                                               public/fonts/ so the app can
 *                                               serve them, byte for byte --
 *                                               the KFGQPC licence permits
 *                                               distributing them but not
 *                                               altering them, so nothing here
 *                                               subsets or re-compresses.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'data', 'qul');
const at = name => path.join(DIR, name);

const say = (...parts) => console.log(' ', ...parts);

/** Every row of one table, or `null` when that export is not here. */
function rows(file, sql) {
  if (!existsSync(at(file))) return null;
  const db = new DatabaseSync(at(file), { readOnly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

// --- morphology -------------------------------------------------------------
//
// The ayah-level tables are the ones worth keeping whole: `verse_key -> the
// roots in it`, already space-joined, which is a signature for a whole ayah in
// about a hundred kilobytes. The word-level tables are kept as a location index
// -- `surah:ayah:word -> root` -- because that is the shape every question the
// studio asks of them takes: "what is the root of *this* word".
function buildMorphology() {
  const out = { ayah: {}, word: {} };

  for (const [kind, file, table] of [
    ['roots', 'ayah-root.db', 'roots'],
    ['lemmas', 'ayah-lemma.db', 'lemmas'],
    ['stems', 'ayah-stem.db', 'stems']
  ]) {
    const list = rows(file, `SELECT verse_key, text FROM ${table}`);
    if (!list) { say(`skipped ${file} (not here)`); continue; }
    const byKey = {};
    for (const row of list) if (row.verse_key && row.text) byKey[row.verse_key] = row.text;
    out.ayah[kind] = byKey;
    say(`${file}: ${Object.keys(byKey).length} ayahs`);
  }

  for (const [kind, file, table, join, idColumn, textColumn] of [
    ['roots', 'word-root.db', 'roots', 'root_words', 'root_id', 'arabic_trilateral'],
    ['lemmas', 'word-lemma.db', 'lemmas', 'lemma_words', 'lemma_id', 'text_clean'],
    ['stems', 'word-stem.db', 'stems', 'stem_words', 'stem_id', 'text_clean']
  ]) {
    const list = rows(
      file,
      `SELECT w.word_location AS loc, t.${textColumn} AS text
         FROM ${join} w JOIN ${table} t ON t.id = w.${idColumn}`
    );
    if (!list) { say(`skipped ${file} (not here)`); continue; }
    const byLocation = {};
    for (const row of list) if (row.loc && row.text) byLocation[row.loc] = row.text;
    out.word[kind] = byLocation;
    say(`${file}: ${Object.keys(byLocation).length} words`);
  }

  return Object.keys(out.ayah).length || Object.keys(out.word).length ? out : null;
}

// --- mutashabihat -----------------------------------------------------------
//
// Reshaped around the question the studio asks. The export is keyed by phrase
// -- "here is a phrase, and the seventy places it occurs" -- while the studio
// always starts from an ayah it is showing and wants to know whether any of its
// words belong to such a phrase. So it is inverted to
// `verse key -> [{ from, to, phrase id }]`, and each phrase keeps only where
// else it occurs.
function buildMutashabihat() {
  if (!existsSync(at('phrases.json'))) { say('skipped phrases.json (not here)'); return null; }
  const phrases = JSON.parse(readFileSync(at('phrases.json'), 'utf8'));

  const occurrences = {};
  const byVerse = {};

  for (const [id, phrase] of Object.entries(phrases)) {
    const places = phrase?.ayah;
    if (!places || typeof places !== 'object') continue;

    const flat = [];
    for (const [verseKey, ranges] of Object.entries(places)) {
      for (const range of ranges || []) {
        const [from, to] = range;
        if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
        flat.push({ verseKey, from, to });
        (byVerse[verseKey] ||= []).push({ from, to, phrase: id });
      }
    }
    if (flat.length < 2) continue;   // a phrase occurring once is not a repeat
    occurrences[id] = flat;
  }

  // Drop the ayah entries whose phrase turned out to be unique.
  for (const [verseKey, list] of Object.entries(byVerse)) {
    const kept = list.filter(entry => occurrences[entry.phrase]);
    if (kept.length) byVerse[verseKey] = kept;
    else delete byVerse[verseKey];
  }

  say(`phrases.json: ${Object.keys(occurrences).length} repeated phrases across ${Object.keys(byVerse).length} ayahs`);
  return { phrases: occurrences, byVerse };
}


/**
 * Unpack the font archives into public/fonts/.
 *
 * QUL's naming is not to be trusted -- the QPC V2 pack arrives called
 * `.woff2.bz2` and is in fact a zip -- so each archive is identified by its
 * magic bytes rather than its extension.
 */
function installFonts() {
  const dir = at('fonts');
  if (!existsSync(dir)) return null;

  const jobs = [
    { match: /qpc.*v2/i, into: 'qcf', rename: null },
    { match: /surah-name/i, into: 'surah-name', rename: null },
    // KFGQPC Nastaleeq is deliberately absent: it has an empty glyph for
    // U+06DF, so a silent letter renders as a dotted circle.
    { match: /digitalkhatt|indopaknastaleeq|indopak/i, into: 'unicode', rename: null }
  ];
  let written = 0;
  for (const file of readdirSync(dir)) {
    const job = jobs.find(candidate => candidate.match.test(file));
    if (!job) continue;
    const head = readFileSync(at(path.join('fonts', file))).subarray(0, 2).toString('latin1');
    const target = path.join(process.cwd(), 'public', 'fonts', job.into);
    mkdirSync(target, { recursive: true });
    if (head === 'PK') {
      execFileSync('unzip', ['-q', '-o', at(path.join('fonts', file)), '-d', target]);
    } else if (head === 'BZ') {
      const out = path.join(target, file.replace(/\.bz2$/, ''));
      writeFileSync(out, execFileSync('bunzip2', ['-kc', at(path.join('fonts', file))], { maxBuffer: 1 << 28 }));
    } else {
      continue;
    }
    written += 1;
  }
  // QUL ships the Indopak Nastaleeq face as a bare `font.woff2`; the @font-face
  // rule names the file, so it cannot stay ambiguous.
  const vague = path.join(process.cwd(), 'public', 'fonts', 'unicode', 'font.woff2');
  if (existsSync(vague)) renameSync(vague, path.join(path.dirname(vague), 'IndopakNastaleeq.woff2'));

  if (written) {
    const pages = existsSync(path.join(process.cwd(), 'public', 'fonts', 'qcf'))
      ? readdirSync(path.join(process.cwd(), 'public', 'fonts', 'qcf')).length
      : 0;
    say(`fonts: unpacked ${written} archive(s)${pages ? `, ${pages} mushaf page font(s)` : ''}`);
  }
  return written || null;
}

const fonts = installFonts();

const morphology = buildMorphology();
if (morphology) {
  writeFileSync(at('morphology.json'), JSON.stringify(morphology));
  say(`wrote morphology.json (${(JSON.stringify(morphology).length / 1e6).toFixed(2)} MB)`);
}

const mutashabihat = buildMutashabihat();
if (mutashabihat) {
  writeFileSync(at('mutashabihat.json'), JSON.stringify(mutashabihat));
  say(`wrote mutashabihat.json (${(JSON.stringify(mutashabihat).length / 1e6).toFixed(2)} MB)`);
}

if (!morphology && !mutashabihat && !fonts) {
  console.error('Nothing to import. Put the QUL exports in data/qul/ first.');
  process.exit(1);
}
