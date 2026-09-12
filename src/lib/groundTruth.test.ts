import { describe, it, expect } from 'vitest';
import { groundTruthFile, groundTruthFileName, groundTruthAudioName } from './groundTruth';
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

describe('the audio saved beside a ground-truth file', () => {
  it('shares its stem with the expected file, so `# clip:` finds it', () => {
    expect(groundTruthAudioName('test5.mp3')).toBe('test5.mp3');
    expect(groundTruthFileName('test5.mp3')).toBe('expected_test5.txt');
  });

  it('strips a name that would be a menace as an argument', () => {
    // A real one: emoji, hashes, spaces and brackets, straight from YouTube.
    expect(groundTruthAudioName('Surah Hashr 😭 #quran [4LXn]-trimmed.wav'))
      .toBe('Surah_Hashr_quran_4LXn_-trimmed.wav');
  });

  it('refuses an extension it does not recognise, rather than writing it', () => {
    expect(groundTruthAudioName('clip.exe')).toBe('clip.wav');
    expect(groundTruthAudioName('')).toBe('timeline.wav');
  });

  it('says the audio needs no cutting once a copy travels with the file', () => {
    // The bug this is about: the file named the trimmed audio and carried a
    // window measured in the original's clock, so anything acting on both cut
    // a window out of a window.
    const verses = [{ verseKey: '3:5', verseNumber: 5, textUthmani: 'إِنَّ ٱللَّهَ', translation: '', startTime: 0, endTime: 2 }];
    const file = groundTruthFile(verses, {
      clipName: 'Aal-E-Imran-trimmed.wav',
      trim: null,
      from: { name: 'Aal-E-Imran.wav', start: 57.8, end: 148.96 },
    });
    expect(file).toContain('# clip: Aal-E-Imran-trimmed.wav');
    expect(file).toContain('# trim: none');
    expect(file).toContain('# from: Aal-E-Imran.wav 57.80-148.96');
  });

  it('leaves the provenance line out when there was no trim to record', () => {
    const verses = [{ verseKey: '3:5', verseNumber: 5, textUthmani: 'إِنَّ ٱللَّهَ', translation: '', startTime: 0, endTime: 2 }];
    expect(groundTruthFile(verses, { clipName: 'test5.mp3' })).not.toContain('# from:');
  });
});

describe('clips whose names do not survive the strip', () => {
  const arabic = '{التائبون العابدون الحامدون السائحون} تلاوة عراقية مؤثرة ياسر الدوسري.mp3';
  const other = 'سورة الحشر عبدالله مصطفى.mp3';

  it('keeps two differently-named clips apart', () => {
    // Both reduce to `_` on their own, so without this the second export
    // overwrites the first -- destroying a hand-corrected timeline silently.
    expect(groundTruthFileName(arabic)).not.toBe(groundTruthFileName(other));
    expect(groundTruthAudioName(arabic)).not.toBe(groundTruthAudioName(other));
  });

  it('keeps them apart after the studio has trimmed them', () => {
    expect(groundTruthFileName('_-trimmed-trimmed.wav')).not.toBe(groundTruthFileName(arabic));
    expect(groundTruthFileName(arabic.replace('.mp3', '-trimmed-trimmed.wav')))
      .not.toBe(groundTruthFileName(other.replace('.mp3', '-trimmed-trimmed.wav')));
  });

  it('gives the same name for the same clip every time', () => {
    expect(groundTruthFileName(arabic)).toBe(groundTruthFileName(arabic));
  });

  it('leaves a name that carries any identity of its own alone', () => {
    expect(groundTruthFileName('test5.mp3')).toBe('expected_test5.txt');
    expect(groundTruthFileName('my clip (2).mp3')).toBe('expected_my_clip_2_.txt');
    expect(groundTruthAudioName('Aal-E-Imran-trimmed.wav')).toBe('Aal-E-Imran-trimmed.wav');
  });
});
