import { describe, it, expect } from 'vitest';
import { chooseReciterTiming, type QuranComTimings, type QulTimings } from './reciterTimingChoice';

const quranCom = (keys: string[]): QuranComTimings => ({
  audioUrl: 'https://download.quranicaudio.com/qdc/x/40.mp3',
  totalSeconds: 900,
  timings: new Map(keys.map((key, i) => [key, { start: i * 10, end: i * 10 + 9 }])),
});
const qul = (keys: string[]): QulTimings => ({
  audioUrl: 'https://audio-cdn.tarteel.ai/quran/surah/x/040.mp3',
  lastMs: 812_000,
  timings: new Map(keys.map((key, i) => [key, { from: 5000 + i * 7000, to: 11500 + i * 7000 }])),
});

describe('chooseReciterTiming', () => {
  const keys = ['40:13', '40:14'];

  it("passes over a source whose timing of an ayah is broken", () => {
    // Shuraim's QUL 2:144 times its second word at 2026s.
    const smeared = qul(keys);
    smeared.timings.set('40:14', { from: 12000, to: 2_040_000, segments: [[1, 12000, 14000], [2, 14000, 2_040_000]] });
    expect(chooseReciterTiming(keys, null, smeared).provider).toBeNull();
    expect(chooseReciterTiming(keys, quranCom(keys), smeared).provider).toBe('quran.com');
    // The opening letters of a surah are long, and real.
    smeared.timings.set('40:14', { from: 12000, to: 27000, segments: [[1, 12000, 27000]] });
    expect(chooseReciterTiming(keys, null, smeared).provider).toBe('qul');
  });

  it('keeps quran.com wherever it timed every ayah, so those reciters load as before', () => {
    const choice = chooseReciterTiming(keys, quranCom(keys), qul(keys));
    expect(choice.provider).toBe('quran.com');
    expect(choice.audioUrl).toContain('quranicaudio');
    expect(choice.boundsFor('40:14')).toEqual({ start: 10, end: 19 });
  });

  it('uses QUL, in seconds and with its own recording, for a reciter quran.com has not timed', () => {
    const choice = chooseReciterTiming(keys, null, qul(keys));
    expect(choice.provider).toBe('qul');
    expect(choice.audioUrl).toContain('tarteel');
    expect(choice.boundsFor('40:13')).toEqual({ start: 5, end: 11.5 });
    expect(choice.totalSeconds).toBe(812);
  });

  it('never mixes sources inside one range', () => {
    // quran.com has only one of the two: QUL's full set is used, not a blend.
    expect(chooseReciterTiming(keys, quranCom(['40:13']), qul(keys)).provider).toBe('qul');
    // Neither covers the range: estimated, and the default recording kept.
    const none = chooseReciterTiming(keys, quranCom(['40:13']), qul(['40:14']));
    expect(none).toMatchObject({ provider: null, audioUrl: null, totalSeconds: null });
    expect(none.boundsFor('40:13')).toBeNull();
    expect(none.published('40:13')).toBeNull();
  });

  it('hands over each source’s word segments in milliseconds, for splitting into phrases', () => {
    const withWords = quranCom(keys);
    withWords.timings.set('40:13', { start: 0, end: 9, segments: [[1, 0, 4000], [2, 4000, 9000]] });
    expect(chooseReciterTiming(keys, withWords, null).published('40:13')).toEqual({
      from: 0, to: 9000, segments: [[1, 0, 4000], [2, 4000, 9000]],
    });
    expect(chooseReciterTiming(keys, null, qul(keys)).published('40:14')).toEqual({ from: 12000, to: 18500 });
  });
});

describe('chooseReciterTiming with an audited pairing', () => {
  const keys = ['5:41', '5:42'];

  it("plays QUL's timings on the recording they fit, not the one QUL names (Sudais 5)", () => {
    // quran.com's timings end 38s short of its own file, which was replaced
    // after they were measured; QUL's end on that file to the hundredth.
    const choice = chooseReciterTiming(keys, quranCom(keys), qul(keys), {
      timings: 'qul',
      audioUrl: 'https://download.quranicaudio.com/qdc/abdurrahmaan_as_sudais/murattal/5.mp3',
    });
    expect(choice.provider).toBe('qul');
    expect(choice.audioUrl).toBe('https://download.quranicaudio.com/qdc/abdurrahmaan_as_sudais/murattal/5.mp3');
    expect(choice.boundsFor('5:41')).toEqual({ start: 5, end: 11.5 });
  });

  it('uses no timings where none fit any recording, whatever the sources hold', () => {
    expect(chooseReciterTiming(keys, quranCom(keys), qul(keys), null).provider).toBeNull();
  });

  it('never falls back to the other source when the audited one is missing', () => {
    // A server without QUL's exports: estimated, not quran.com's unfit timings.
    expect(chooseReciterTiming(keys, quranCom(keys), null, { timings: 'qul' }).provider).toBeNull();
    expect(chooseReciterTiming(keys, quranCom(keys), null, { timings: 'quran.com' }).provider).toBe('quran.com');
  });

  it('keeps the old order for a surah never audited', () => {
    expect(chooseReciterTiming(keys, quranCom(keys), qul(keys), undefined).provider).toBe('quran.com');
  });
});

describe('timingPair', () => {
  it('reads the audited table, including a pairing on the other source’s file', async () => {
    const { timingPair } = await import('./timingAudit');
    expect(timingPair('sudais', 5)).toEqual({
      timings: 'qul',
      audioUrl: 'https://download.quranicaudio.com/qdc/abdurrahmaan_as_sudais/murattal/5.mp3',
    });
    expect(timingPair('sudais', 3)).toEqual({ timings: 'qul' });
    expect(timingPair('sudais', 1)).toEqual({ timings: 'quran.com' });
    expect(timingPair('nobody', 1)).toBeUndefined();
  });

  it("lets quran.com's own button use its timings only where they fit its recording", async () => {
    const { quranComFits } = await import('./timingAudit');
    // Sudais is quran.com reciter 3.
    expect(quranComFits(3, 1)).toBe(true);
    expect(quranComFits(3, 3)).toBe(false);
    expect(quranComFits(3, 5)).toBe(false);
    expect(quranComFits(9999, 5)).toBe(true);
  });
});
