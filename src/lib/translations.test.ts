import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TRANSLATION_ID, MAX_TRANSLATIONS, TranslationOption,
  toggleTranslation, groupByLanguage, searchTranslations, selectedOptions,
  captionTranslations, missingTranslationIds, isRtlText, isRtlLanguage
} from './translations';

const option = (id: string, name: string, language: string, rtl = false): TranslationOption =>
  ({ id, name, language, rtl });

const catalogue: TranslationOption[] = [
  option('20', 'Saheeh International', 'English'),
  option('85', 'M.A.S. Abdel Haleem', 'English'),
  option('158', 'Fateh Muhammad Jalandhry', 'Urdu', true),
  option('97', 'Muhammad Hamidullah', 'French')
];

describe('choosing translations', () => {
  it('adds one that was not selected', () => {
    expect(toggleTranslation(['20'], '158')).toEqual(['20', '158']);
  });

  it('removes one that was', () => {
    expect(toggleTranslation(['20', '158'], '20')).toEqual(['158']);
  });

  it('refuses to leave a caption with no translation at all', () => {
    // Turning translations off is a different control, and it says so.
    expect(toggleTranslation(['20'], '20')).toEqual(['20']);
  });

  it('stops at the limit rather than shrinking the type until nothing reads', () => {
    const full = ['20', '85', '158'];
    expect(full).toHaveLength(MAX_TRANSLATIONS);
    expect(toggleTranslation(full, '97')).toEqual(full);
  });

  it('keeps an id it does not recognise rather than dropping the selection', () => {
    expect(selectedOptions(['20', '999'], catalogue).map(o => o.id)).toEqual(['20', '999']);
  });
});

describe('the catalogue', () => {
  it('groups by language with English first', () => {
    const groups = groupByLanguage(catalogue);
    expect(groups.map(g => g.language)).toEqual(['English', 'French', 'Urdu']);
    expect(groups[0].options.map(o => o.name)).toEqual(['M.A.S. Abdel Haleem', 'Saheeh International']);
  });

  it('searches by translator and by language', () => {
    expect(searchTranslations(catalogue, 'haleem').map(o => o.id)).toEqual(['85']);
    expect(searchTranslations(catalogue, 'urdu').map(o => o.id)).toEqual(['158']);
    expect(searchTranslations(catalogue, '')).toHaveLength(4);
  });

  it('knows which languages read right to left', () => {
    expect(isRtlLanguage('urdu')).toBe(true);
    expect(isRtlLanguage('English')).toBe(false);
  });
});

describe('what a caption shows', () => {
  const verse = {
    translation: 'In the name of Allah',
    translations: { '158': 'اللہ کے نام سے', '97': 'Au nom d’Allah' }
  };

  it('defaults to the translation the caption already carried', () => {
    expect(captionTranslations(verse, [DEFAULT_TRANSLATION_ID])).toEqual([
      { id: '20', text: 'In the name of Allah', rtl: false }
    ]);
  });

  it('prefers the caption’s own words for the default translation', () => {
    // A split or hand-edited caption covers part of the ayah, and that part is
    // what `displayTranslation` holds.
    const split = { ...verse, displayTranslation: 'In the name of' };
    expect(captionTranslations(split, ['20'])[0].text).toBe('In the name of');
  });

  it('shows several, in the order they were chosen', () => {
    expect(captionTranslations(verse, ['158', '20']).map(t => t.id)).toEqual(['158', '20']);
  });

  it('marks a right-to-left translation by its script, not by a catalogue', () => {
    const [urdu] = captionTranslations(verse, ['158']);
    expect(urdu.rtl).toBe(true);
    expect(isRtlText('Au nom d’Allah')).toBe(false);
  });

  it('skips a translation that has not arrived yet rather than drawing a gap', () => {
    expect(captionTranslations(verse, ['20', '131'])).toHaveLength(1);
  });

  it('falls back to the default when nothing is selected', () => {
    expect(captionTranslations(verse, [])).toHaveLength(1);
  });
});

describe('fetching what is missing', () => {
  const verses: { verseKey: string; translations?: Record<string, string> }[] = [
    { verseKey: '1:1', translations: { '158': 'اللہ' } },
    { verseKey: '1:2', translations: {} }
  ];

  it('never asks for the default, which every caption already has', () => {
    expect(missingTranslationIds(verses, ['20'])).toEqual([]);
  });

  it('asks for one that any caption is missing', () => {
    expect(missingTranslationIds(verses, ['20', '158'])).toEqual(['158']);
  });

  it('asks for nothing when every caption has every translation', () => {
    const complete = [{ verseKey: '1:1', translations: { '158': 'x' } }];
    expect(missingTranslationIds(complete, ['20', '158'])).toEqual([]);
  });
});
