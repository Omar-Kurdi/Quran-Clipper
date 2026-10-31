import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CORE, GLOSSES, MUSHAF, SPELLING, editionsAfter, folderOf, surahFiles } from '../../scripts/qf-text.mjs';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('./localTranslations', () => ({ localEditions: () => [], localSurah: () => null, localAyah: () => '' }));

const { execFile } = await import('node:child_process');
const { storedChapter, storedEditionIds, storedTranslationTexts } = await import('./qfTextStore');

const DAY = 24 * 60 * 60 * 1000;

// 112:1 as the snapshots give it (2026-10-31): the verse, its words and the end marker, word ids as QF numbers them.
const coreRecords = [
  { record_type: 'chapter', id: 112 },
  { record_type: 'verse', id: 6222, chapter_id: 112, verse_number: 1, verse_key: '112:1', text_uthmani: 'قُلْ هُوَ ٱللَّهُ أَحَدٌ' },
  ...['قُلْ', 'هُوَ', 'ٱللَّهُ', 'أَحَدٌ', '١'].map((text, i) => ({
    record_type: 'word', id: 6 + i, verse_id: 6222, chapter_id: 112, position: i + 1, verse_key: '112:1',
    char_type_name: i < 4 ? 'word' : 'end', text_indopak: text, _uthmani: text,
  })),
];
const words = coreRecords.filter(r => r.record_type === 'word') as { id: number; _uthmani: string }[];
const wordSurah = () => 112;

function writeStore(dir: string, syncedAt: string, editions = ['20', '85']) {
  const resources: Record<string, { syncedAt: string }> = {};
  const put = (resource: string, files: Map<number, unknown>) => {
    resources[resource] = { syncedAt };
    mkdirSync(path.join(dir, folderOf(resource)), { recursive: true });
    for (const [surah, data] of files) writeFileSync(path.join(dir, folderOf(resource), `${String(surah).padStart(3, '0')}.json`), JSON.stringify(data));
  };
  put(CORE, surahFiles(CORE, coreRecords, null));
  put(MUSHAF, surahFiles(MUSHAF, words.map((w, i) => ({ record_type: 'mushaf_word', word_id: w.id, text: String.fromCodePoint(0xfc41 + i), page_number: 604, line_number: 3 })), wordSurah));
  put(SPELLING, surahFiles(SPELLING, words.map(w => ({ record_type: 'mushaf_word', word_id: w.id, text: w._uthmani })), wordSurah));
  put(GLOSSES, surahFiles(GLOSSES, words.map((w, i) => ({ word_id: w.id, text: ['Say', 'He', '(is) Allah', 'the One', '(1)'][i] })), wordSurah));
  put('translations:20', surahFiles('translations:20', [{ verse_key: '112:1', chapter_id: 112, text: 'Say, "He is Allāh, [who is] One,<sup foot_note=1>1</sup>' }], wordSurah));
  resources['translations:*'] = { syncedAt };
  writeFileSync(path.join(dir, 'sync.json'), JSON.stringify({ resources, editions }));
}

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'qf-text-'));
  process.env.QC_QF_TEXT_DIR = dir;
  vi.mocked(execFile).mockClear();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.QC_QF_TEXT_DIR;
});

describe('the Content Sync text store', () => {
  it('reads a surah as the API gives it: the verse spelling, glosses, glyphs and the cleaned translation', () => {
    writeStore(dir, new Date().toISOString());
    const [verse] = storedChapter(112, ['20']) ?? [];
    expect(verse.verseKey).toBe('112:1');
    expect(verse.translation).toBe('Say, "He is Allāh, [who is] One,');
    expect(verse.words.map(w => w.arabic)).toEqual(['قُلْ', 'هُوَ', 'ٱللَّهُ', 'أَحَدٌ']);
    expect(verse.words.map(w => w.translation)).toEqual(['Say', 'He', '(is) Allah', 'the One']);
    expect(verse.words[0]).toMatchObject({ glyph: 'ﱁ', glyphPage: 604, glyphLine: 3 });
  });

  it('does not answer from a store not synced within the seven days', () => {
    writeStore(dir, new Date(Date.now() - 8 * DAY).toISOString());
    expect(storedChapter(112, ['20'])).toBeNull();
    expect(storedEditionIds()).toBeNull();
  });

  it('does not answer before an edition QF serves is held, and starts its sync', () => {
    writeStore(dir, new Date().toISOString());
    expect(storedChapter(112, ['85', '20'])).toBeNull();
    expect(storedTranslationTexts(112, 1, 4, ['85'])).toBeNull();
    expect(vi.mocked(execFile).mock.calls[0][1]).toEqual(expect.arrayContaining(['--add', '85']));
  });

  it('leaves out an edition nobody serves, rather than holding the check back', () => {
    writeStore(dir, new Date().toISOString(), ['20']);
    expect(storedTranslationTexts(112, 1, 4, ['20', '85'])).toEqual({ '112:1': { 20: 'Say, "He is Allāh, [who is] One,' } });
    expect(storedEditionIds()).toEqual(new Set(['20']));
  });
});

describe('the editions QF serves', () => {
  it('follow the resource-level changes in order', () => {
    expect(editionsAfter(['20'], [
      { sequence: 3, type: 'RESOURCE_DELETE', resource_id: 85 },
      { sequence: 1, type: 'RESOURCE_CREATE', resource_id: 85 },
      { sequence: 2, type: 'RESOURCE_UPDATE', resource_id: 20 },
      { sequence: 4, type: 'RESOURCE_CREATE', resource_id: 131 },
    ])).toEqual(['20', '131']);
  });
});
