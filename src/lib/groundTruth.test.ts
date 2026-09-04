import { describe, it, expect } from 'vitest';
import { groundTruthFile, groundTruthFileName } from './groundTruth';
import type { VerseData } from './quranData';

const verse = (verseKey: string, textUthmani: string, extra: Partial<VerseData> = {}): VerseData => ({
  verseNumber: Number(verseKey.split(':')[1]),
  verseKey,
  textUthmani,
  translation: '',
  startTime: 0,
  endTime: 1,
  ...extra,
});

describe('groundTruthFile', () => {
  const timeline = [
    verse('66:6', 'يَا أَيُّهَا الَّذِينَ آمَنُوا'),
    verse('66:6', 'وَقُودُهَا النَّاسُ'),
    verse('66:7', 'لَا تَعْتَذِرُوا الْيَوْمَ'),
  ];

  it('writes one line per caption, in order', () => {
    const body = groundTruthFile(timeline).split('\n').filter(l => l && !l.startsWith('#'));
    expect(body).toEqual([
      'يَا أَيُّهَا الَّذِينَ آمَنُوا',
      'وَقُودُهَا النَّاسُ',
      'لَا تَعْتَذِرُوا الْيَوْمَ',
    ]);
  });

  it('names the passage it came from', () => {
    expect(groundTruthFile(timeline, { clipName: 'test_this.mp3' })).toContain('test_this.mp3');
    expect(groundTruthFile(timeline)).toContain('At-Tahrim 66:6-7');
  });

  it('writes what was recited, not the whole ayah', () => {
    // A caption shows the words the reciter actually said; scoring against the
    // full ayah would mark a correct partial caption wrong.
    const partial = [verse('66:6', 'كل الآية', {
      words: [
        { arabic: 'أ', translation: '' },
        { arabic: 'ب', translation: '', excluded: true },
        { arabic: 'ج', translation: '' },
      ],
    })];
    expect(groundTruthFile(partial)).toContain('أ ج');
    expect(groundTruthFile(partial)).not.toContain('كل الآية');
  });

  it('prefers the display text when there is no word list', () => {
    const shown = [verse('66:6', 'الآية كاملة', { displayTextUthmani: 'جزء منها' })];
    expect(groundTruthFile(shown)).toContain('جزء منها');
  });

  it('says overlap is deliberate, so nobody tidies it away', () => {
    const restart = [
      verse('66:6', 'أ ب ج'),
      verse('66:6', 'ج د هـ'),
    ];
    expect(groundTruthFile(restart)).toMatch(/restarting an earlier phrase/);
  });

  it('does not claim an overlap that is not there', () => {
    expect(groundTruthFile(timeline)).not.toMatch(/restarting an earlier phrase/);
  });

  it('returns nothing for an empty timeline, rather than a bare header', () => {
    expect(groundTruthFile([])).toBe('');
  });

  it('describes a multi-surah timeline as such', () => {
    const across = [verse('1:1', 'أ'), verse('2:1', 'ب')];
    expect(groundTruthFile(across)).toContain('2 surahs');
  });

  it('is readable by the evaluator: comments, blank line, then segments', () => {
    const lines = groundTruthFile(timeline).split('\n');
    expect(lines[0].startsWith('#')).toBe(true);
    const firstBody = lines.findIndex(l => l && !l.startsWith('#'));
    expect(lines[firstBody - 1]).toBe('');
  });
});

describe('groundTruthFileName', () => {
  it('names the file after the clip', () => {
    expect(groundTruthFileName('test5.mp3')).toBe('expected_test5.txt');
  });

  it('strips characters a filesystem would reject', () => {
    expect(groundTruthFileName('my clip (2).mp3')).toBe('expected_my_clip_2_.txt');
  });

  it('still produces a name when it has nothing to go on', () => {
    expect(groundTruthFileName()).toBe('expected_timeline.txt');
  });
});

describe('metadata block', () => {
  const verses: VerseData[] = [
    { verseNumber: 122, verseKey: '2:122', textUthmani: 'أ ب', translation: '', startTime: 0, endTime: 4 },
    { verseNumber: 123, verseKey: '2:123', textUthmani: 'ج د', translation: '', startTime: 4, endTime: 9 },
  ];

  it('records the clip, passage and length so nothing has to be retyped', () => {
    const file = groundTruthFile(verses, { clipName: 'test3.mp3', duration: 110 });
    expect(file).toContain('# clip: test3.mp3');
    expect(file).toContain('# passage: 2:122-123');
    expect(file).toContain('# audio-seconds: 110.00');
  });

  it('records the trim window, because trimming never touches the file on disk', () => {
    // Without this the evaluator scores a trimmed timeline against the whole
    // recording and reports failures that are not real.
    const file = groundTruthFile(verses, { clipName: 'test3.mp3', trim: { start: 12.5, end: 98 } });
    expect(file).toContain('# trim: 12.50-98.00');
  });

  it('says so explicitly when nothing was trimmed', () => {
    // An absent line and an untrimmed clip must not look the same to a reader
    // that defaults one of them.
    expect(groundTruthFile(verses, { clipName: 'a.mp3' })).toContain('# trim: none');
  });

  it('marks a fact unknown rather than guessing it', () => {
    const file = groundTruthFile(verses, {});
    expect(file).toContain('# clip: unknown');
    expect(file).toContain('# audio-seconds: unknown');
  });
});
