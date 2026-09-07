import { describe, it, expect } from 'vitest';
import {
  buildPublishMetadata, ayahReference, hashtagFor,
  TITLE_MAX, DESCRIPTION_MAX, TAGS_MAX
} from './publishMetadata';
import { VerseData } from './quranData';

const verse = (key: string, arabic: string, translation: string): VerseData => ({
  verseNumber: Number(key.split(':')[1]),
  verseKey: key,
  textUthmani: arabic,
  translation,
  startTime: 0,
  endTime: 1
});

const base = {
  surahNumber: 1,
  surahNameArabic: 'الفاتحة',
  surahNameEnglish: 'Al-Fatihah',
  ayahStart: 1,
  ayahEnd: 7,
  reciterName: 'Abdul Rahman Al-Sudais'
};

describe('publish metadata', () => {
  it('references a range and a single ayah differently', () => {
    expect(ayahReference(1, 1, 7)).toBe('1:1-7');
    expect(ayahReference(1, 5, 5)).toBe('1:5');
  });

  it('makes a hashtag that does not break on the surah name punctuation', () => {
    expect(hashtagFor('Al-Fatihah')).toBe('#AlFatihah');
    expect(hashtagFor("Al-An'am")).toBe('#AlAnam');
    expect(hashtagFor('')).toBe('');
  });

  it('titles the clip by what it is, and marks it as a Short', () => {
    const meta = buildPublishMetadata(base);
    expect(meta.title).toBe('Surah Al-Fatihah 1:1-7 | Abdul Rahman Al-Sudais #Shorts');
    expect(meta.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(meta.truncated).toBe(false);
  });

  it('drops the reciter rather than the passage when the title will not fit', () => {
    const meta = buildPublishMetadata({
      ...base,
      surahNameEnglish: 'Al-Fatihah',
      reciterName: 'A Reciter With An Extremely Long Name '.repeat(3)
    });
    expect(meta.title).toContain('Al-Fatihah 1:1-7');
    expect(meta.title).toContain('#Shorts');
    expect(meta.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(meta.truncated).toBe(true);
  });

  it('tags the surah both as a name and as a title', () => {
    const meta = buildPublishMetadata({ ...base, surahNameEnglish: "Al-'Ankabut" });
    expect(meta.hashtags).toContain('#AlAnkabut');
    expect(meta.hashtags).toContain('#SurahAlAnkabut');
    expect(meta.hashtags[meta.hashtags.length - 1]).toBe('#SurahAlAnkabut');
    expect(meta.description).toContain('#SurahAlAnkabut');
  });

  it('does not repeat a tag when the two forms collide', () => {
    // "Surah Sad" and "Sad" differ, but a name that already begins with the
    // word would not -- guard the general case rather than the example.
    const meta = buildPublishMetadata({ ...base, surahNameEnglish: 'Surah' });
    expect(meta.hashtags.filter(tag => tag === '#Surah')).toHaveLength(1);
  });

  it('credits the source even when no translation is named', () => {
    const meta = buildPublishMetadata(base);
    expect(meta.description).toContain('quran.com');
    expect(meta.description).not.toContain('Translation:');
  });

  it('names the translations that are on screen', () => {
    const meta = buildPublishMetadata({ ...base, translationNames: ['Saheeh International'] });
    expect(meta.description).toContain('Translation: Saheeh International');
  });

  it('leaves the ayah text out unless it is asked for', () => {
    const verses = [verse('1:1', 'بِسْمِ ٱللَّهِ', 'In the name of Allah')];
    expect(buildPublishMetadata({ ...base, verses }).description).not.toContain('In the name of Allah');
    const withText = buildPublishMetadata({ ...base, verses, includeVerseText: true });
    expect(withText.description).toContain('بِسْمِ ٱللَّهِ');
    expect(withText.description).toContain('In the name of Allah');
  });

  it('prints a repeated ayah once', () => {
    // Two captions of the same ayah is how a repeated phrase is stored.
    const verses = [
      verse('1:5', 'إِيَّاكَ نَعْبُدُ', 'It is You we worship'),
      verse('1:5', 'إِيَّاكَ نَعْبُدُ', 'It is You we worship')
    ];
    const meta = buildPublishMetadata({ ...base, verses, includeVerseText: true });
    expect(meta.description.split('It is You we worship').length - 1).toBe(1);
  });

  it('keeps the credits and hashtags when a passage is too long to fit', () => {
    const verses = Array.from({ length: 400 }, (_, i) =>
      verse(`2:${i + 1}`, 'ا'.repeat(60), 'x'.repeat(60))
    );
    const meta = buildPublishMetadata({
      ...base,
      surahNumber: 2,
      surahNameEnglish: 'Al-Baqarah',
      ayahEnd: 400,
      translationNames: ['Saheeh International'],
      verses,
      includeVerseText: true
    });
    expect(meta.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(meta.description).toContain('Translation: Saheeh International');
    expect(meta.description).toContain('#Shorts');
    expect(meta.truncated).toBe(true);
  });

  it('keeps every keyword whole and inside the tag budget', () => {
    const meta = buildPublishMetadata(base);
    expect(meta.tags.join(', ').length).toBeLessThanOrEqual(TAGS_MAX);
    expect(meta.tags).toContain('quran recitation');
    expect(meta.tags).toContain('1:1-7');
  });

  it('follows the timeline range rather than what was loaded', () => {
    // A trim narrows the clip; the caption has to say what the video contains.
    const meta = buildPublishMetadata({ ...base, ayahStart: 3, ayahEnd: 7 });
    expect(meta.title).toContain('1:3-7');
    expect(meta.description).toContain('Ayah 3-7');
  });
});
