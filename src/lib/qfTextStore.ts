/**
 * The Quran text held through Content Sync (`scripts/qf-text.mjs`), read the
 * way the ordinary API's answers are read, for the weekly check of saved
 * projects (`contentSync.ts`).
 *
 * QF's Developer Terms want content that is kept to be obtained and
 * maintained through Content Sync. A saved project keeps its text, so the
 * text it is checked against comes from here when the client id and secret
 * are set. A part of the store that is missing, or not synced in the last
 * seven days, answers null -- "not checked" -- and the project is tried again
 * later, never stripped. An edition no project used before is added by the
 * next sync, which a miss starts.
 *
 * Server-only.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONTENT_SYNC_MAX_AGE_MS } from './contentSyncAge';
import { cleanHtml, verseWords, type CorpusVerse } from './quranCorpus';
import { localAyah, localEditions, localSurah } from './localTranslations';
import type { TranslationTexts } from './translationTexts';

const CORE = 'quran_core:1';
const MUSHAF = 'mushafs:1';
const SPELLING = 'mushafs:4';
const GLOSSES = 'word_by_word_translations:59';
const EDITIONS = 'translations:*';

const storeDir = () => process.env.QC_QF_TEXT_DIR ||
  path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'quran-clipper', 'qf-text');

interface StoreState {
  resources: Record<string, { syncedAt?: string; removed?: boolean }>;
  editions?: string[];
}

interface StoredWord {
  id: number;
  char_type_name: string;
  text_indopak?: string;
}

interface StoredVerse {
  verse_key: string;
  verse_number: number;
  text_uthmani: string;
  words: StoredWord[];
}

/** One of the store's files, or null when it is missing or not what the store writes (an object or a list). */
function readJson<T extends object>(...parts: string[]): T | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path.join(storeDir(), ...parts), 'utf8'));
  } catch {
    return null;
  }
  return isStored<T>(parsed) ? parsed : null;
}

const isStored = <T extends object>(value: unknown): value is T => typeof value === 'object' && value !== null;

/** The store's state, or null when it has never been synced. */
const readState = () => readJson<StoreState>('sync.json');

/** Whether `resource` was synced within the seven days, as the terms require of what is read. */
function current(state: StoreState | null, resource: string, now = Date.now()): boolean {
  const entry = state?.resources[resource];
  const at = Date.parse(entry?.syncedAt ?? '');
  return Boolean(entry && !entry.removed && Number.isFinite(at) && now - at < CONTENT_SYNC_MAX_AGE_MS);
}

let adding: Set<string> = new Set();

/** Asks the next sync to add `ids` and starts it; one request per edition per server. */
function requestEditions(ids: string[]): void {
  const fresh = ids.filter(id => !adding.has(id));
  if (!fresh.length) return;
  adding = new Set([...adding, ...fresh]);
  execFile(process.execPath, [path.join(process.cwd(), 'scripts', 'qf-text.mjs'), 'sync', '--if-due', '--quiet', '--add', fresh.join(',')],
    { timeout: 60 * 60 * 1000 }, (error, _stdout, stderr) => {
      // Asked again on the next miss.
      for (const id of fresh) adding.delete(id);
      if (error) console.warn(`[text sync] ${stderr.trim() || error.message}`);
    });
}

const pad = (n: number) => String(n).padStart(3, '0');

/** One held edition's text for a surah, by verse key, cleaned as the API's is. */
function editionSurah(id: string, surah: number): Record<string, string> | null {
  const raw = readJson<Record<string, string>>('translations', id, `${pad(surah)}.json`);
  return raw && Object.fromEntries(Object.entries(raw).map(([key, text]) => [key, cleanHtml(text || '')]));
}

/**
 * One surah in the shape `quranCorpus` gives it, with the caption's own
 * translation from `wanted` (most wanted first), or null when the store
 * cannot answer for it yet.
 */
export function storedChapter(surah: number, wanted: string[]): CorpusVerse[] | null {
  const state = readState();
  if (![CORE, MUSHAF, SPELLING, GLOSSES].every(resource => current(state, resource))) return null;
  const verses = readJson<StoredVerse[]>('core', `${pad(surah)}.json`);
  const glyphs = readJson<Record<string, [string, number, number]>>('mushaf', `${pad(surah)}.json`) ?? {};
  const glosses = readJson<Record<string, string>>('glosses', `${pad(surah)}.json`) ?? {};
  const spellings = readJson<Record<string, string>>('spelling', `${pad(surah)}.json`) ?? {};
  if (!verses?.length) return null;

  // The caption's translation: the first wanted edition held or kept on this machine, as `primaryTranslation` picks it.
  // One QF serves that is not held yet would be passed over for the next, so nothing is answered until it is.
  const held = wanted.filter(id => current(state, `translations:${id}`));
  const missing = wanted.filter(id => !held.includes(id) && state?.editions?.includes(id) && !localEditions().some(e => e.id === id));
  if (missing.length) {
    requestEditions(missing);
    return null;
  }
  const texts = held.map(id => [id, editionSurah(id, surah) ?? {}] as const);

  return verses.map(verse => {
    const words = verseWords({
      verse_key: verse.verse_key,
      text_uthmani: verse.text_uthmani,
      words: verse.words.map(word => {
        const glyph = glyphs[word.id];
        return {
          char_type_name: word.char_type_name,
          // The word as the Uthmani Hafs mushaf writes it, which `verseWords` pairs the verse's own spelling to.
          text_uthmani: spellings[word.id],
          text_indopak: word.text_indopak,
          translation: { text: glosses[word.id] ?? '' },
          ...(glyph ? { code_v2: glyph[0], v2_page: glyph[1], line_v2: glyph[2] } : {}),
        };
      }),
    });
    const translation = wanted.map(id => texts.find(([held]) => held === id)?.[1][verse.verse_key]
      || localAyah(id, surah, verse.verse_number)).find(Boolean) || '';
    return { surahNumber: surah, verseNumber: verse.verse_number, verseKey: verse.verse_key, textUthmani: verse.text_uthmani, translation, words };
  });
}

/**
 * The text of `ids` for ayahs `start`..`end`, as `fetchTranslationTexts` gives
 * it, or null when an edition QF still serves is not held yet (its sync is
 * started). An edition nobody serves simply does not come back.
 */
export function storedTranslationTexts(surah: number, start: number, end: number, ids: string[]): TranslationTexts | null {
  const state = readState();
  const local = new Set(localEditions().map(edition => edition.id));
  const served = ids.filter(id => state?.editions?.includes(id) && !local.has(id));
  const missing = served.filter(id => !current(state, `translations:${id}`));
  if (missing.length) {
    requestEditions(missing);
    return null;
  }
  const into: TranslationTexts = {};
  for (const id of served) {
    for (const [key, text] of Object.entries(editionSurah(id, surah) ?? {})) {
      const ayah = Number(key.split(':')[1]);
      if (ayah >= start && ayah <= end && text) into[key] = { ...into[key], [id]: text };
    }
  }
  for (const id of ids.filter(id => local.has(id))) {
    const verses = localSurah(id, surah) || [];
    for (let ayah = Math.max(1, start); ayah <= Math.min(end, verses.length); ayah++) {
      const key = `${surah}:${ayah}`;
      if (verses[ayah - 1]) into[key] = { ...into[key], [id]: verses[ayah - 1] };
    }
  }
  return into;
}

/** Every edition QF serves, with this machine's own, or null when that list is not current. */
export function storedEditionIds(): Set<string> | null {
  const state = readState();
  if (!current(state, EDITIONS) || !state?.editions?.length) return null;
  return new Set([...state.editions, ...localEditions().map(edition => edition.id)]);
}
