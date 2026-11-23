#!/usr/bin/env node
/**
 * The topic of each group of ayahs, for suggested clips, from QUL's "Ayah
 * theme" export (https://qul.tarteel.ai/resources/ayah-theme).
 *
 *   node scripts/qul-themes.mjs <ayah-themes.db | ayah-themes.db.zip>
 *
 * Written to ~/.local/share/quran-clipper/qul/ayah-themes.json (QC_QUL_DIR to
 * move it), outside the checkout: QUL gives no licence for this resource, so
 * it is kept on this machine and never committed or served beyond it. A
 * studio without the file -- the hosted one -- suggests clips by ruku.
 *
 * The export lists every group twice and leaves some ayahs in none; written
 * once each, in order, and a group overlapping the one before is dropped.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const QUL_DIR = process.env.QC_QUL_DIR ||
  path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'quran-clipper', 'qul');

/** Each surah's groups, `[first, last, theme]`, in order, once each, none overlapping the one before. */
export function themesBySurah(rows) {
  const bySurah = {};
  const sorted = [...rows].sort((a, b) => a.surah - b.surah || a.from - b.from || a.to - b.to);
  for (const row of sorted) {
    const theme = String(row.theme || '').trim();
    if (!theme || !(row.from >= 1) || !(row.to >= row.from)) continue;
    const list = (bySurah[row.surah] ??= []);
    const last = list[list.length - 1];
    if (last && row.from <= last[1]) continue;
    list.push([row.from, row.to, theme]);
  }
  return bySurah;
}

function readRows(file) {
  let db = file;
  let scratch = null;
  if (file.endsWith('.zip')) {
    scratch = mkdtempSync(path.join(os.tmpdir(), 'qul-themes-'));
    execFileSync('unzip', ['-o', '-q', file, '-d', scratch]);
    db = path.join(scratch, 'ayah-themes.db');
  }
  try {
    const connection = new DatabaseSync(db, { readOnly: true });
    const rows = connection.prepare('SELECT surah_number AS surah, ayah_from AS "from", ayah_to AS "to", theme FROM themes').all();
    connection.close();
    return rows;
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/qul-themes.mjs <ayah-themes.db | ayah-themes.db.zip>');
    process.exit(1);
  }
  const bySurah = themesBySurah(readRows(path.resolve(file)));
  mkdirSync(QUL_DIR, { recursive: true });
  const target = path.join(QUL_DIR, 'ayah-themes.json');
  writeFileSync(`${target}.part`, JSON.stringify(bySurah));
  renameSync(`${target}.part`, target);
  const groups = Object.values(bySurah).reduce((sum, list) => sum + list.length, 0);
  console.log(`${groups} groups over ${Object.keys(bySurah).length} surahs -> ${target}`);
}
