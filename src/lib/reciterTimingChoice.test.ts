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
  });
});
