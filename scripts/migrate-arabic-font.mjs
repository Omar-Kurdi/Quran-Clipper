#!/usr/bin/env node
/**
 * Point saved projects at a font that still exists.
 *
 * The studio used to offer five Google faces -- Amiri, Scheherazade New, Noto
 * Naskh, Reem Kufi, Aref Ruqaa -- and every project saved then still names one
 * in `font_arabic`. They are gone: all five draw the sukun as a closed ring,
 * which is the ring the mushaf reserves for a letter that is not pronounced.
 *
 * `resolveArabicFont` already covers this when a project is opened, so nothing
 * is broken without this. What it does not do is change the stored row, so the
 * database keeps claiming a font nobody can choose. This settles that.
 *
 * Idempotent: it only rewrites rows naming a font that is no longer offered,
 * and says how many it found. Safe to run twice.
 *
 *   node scripts/migrate-arabic-font.mjs           report what would change
 *   node scripts/migrate-arabic-font.mjs --write   change it
 */
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

loadEnv({ path: '.env.local' });
loadEnv();

// Kept as literals rather than imported from src/: this is a plain node
// script, and the ids it has to recognise are the *removed* ones, which by
// definition no longer appear in the app's font list.
const RETIRED = ['Amiri', 'Scheherazade New', 'Noto Naskh Arabic', 'Reem Kufi', 'Aref Ruqaa'];
const TARGET = 'qpc-v2';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set, so there is no database to migrate.');
  process.exit(1);
}

const write = process.argv.includes('--write');
const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  const { rows } = await client.query(
    'select font_arabic, count(*)::int as n from projects where font_arabic = any($1) group by font_arabic order by n desc',
    [RETIRED]
  );
  const total = rows.reduce((sum, row) => sum + row.n, 0);

  if (!total) {
    console.log(`  Nothing to do: no project names a retired font.`);
  } else {
    for (const row of rows) console.log(`  ${row.n.toString().padStart(4)}  ${row.font_arabic}`);
    if (!write) {
      console.log(`\n  ${total} project(s) would move to '${TARGET}'. Re-run with --write to do it.`);
    } else {
      const done = await client.query(
        'update projects set font_arabic = $1 where font_arabic = any($2)',
        [TARGET, RETIRED]
      );
      console.log(`\n  Moved ${done.rowCount} project(s) to '${TARGET}'.`);
    }
  }
} finally {
  await client.end();
}
