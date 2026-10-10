import { describe, it, expect } from 'vitest';
import { chooseReciterTiming, pairedRecording, type QuranComTimings, type QulTimings } from './reciterTimingChoice';
import { SAMPLE_PROJECTS } from './quranData';

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

  it("keeps a source whose ayah has one smeared word, leaving the word out (Ghamdi's 3:188)", () => {
    const smeared = qul(keys);
    smeared.timings.set('40:14', { from: 12000, to: 36000, segments: [[1, 12000, 14000], [2, 14000, 270_000], [3, 30000, 36000]] });
    const choice = chooseReciterTiming(keys, null, smeared);
    expect(choice.provider).toBe('qul');
    expect(choice.published('40:14')?.segments).toEqual([[1, 12000, 14000], [3, 30000, 36000]]);
  });

  it('starts an ayah listed from inside the one before where that one ends, or at its first word when later', () => {
    // Ghamdi's 55:1-2: 55:2 listed from 0s, heard at 4.4s after 55:1 ends at 4.1s. Ghamdi's 13:15-16: 13:16 listed
    // from 318.3s, its first word at 319.9s where it is heard, after 13:15 ends at 319.6s.
    const listed = qul(['55:1', '55:2']);
    listed.timings.set('55:1', { from: 0, to: 4071, segments: [[1, 0, 4071]] });
    listed.timings.set('55:2', { from: 0, to: 8213, segments: [[1, 3160, 5360], [2, 5360, 8213]] });
    expect(chooseReciterTiming(['55:1', '55:2'], null, listed).published('55:2')).toEqual({ from: 4071, to: 8213, segments: [[2, 5360, 8213]] });
    const later = qul(['13:15', '13:16']);
    later.timings.set('13:15', { from: 304316, to: 319567, segments: [[1, 304416, 318074]] });
    later.timings.set('13:16', { from: 318274, to: 361180, segments: [[1, 319880, 320200], [2, 320200, 361180]] });
    expect(chooseReciterTiming(['13:15', '13:16'], null, later).published('13:16')?.from).toBe(319880);
  });

  it('leaves an ayah listed before the one before it altogether (Abdul Basit\u2019s 55:70-71)', () => {
    const listed = qul(['55:70', '55:71']);
    listed.timings.set('55:70', { from: 606317, to: 613239 });
    listed.timings.set('55:71', { from: 548421, to: 555695 });
    expect(chooseReciterTiming(['55:70', '55:71'], null, listed).published('55:71')?.from).toBe(548421);
  });

  it("keeps an ayah's bounds without its words when most of the words lie outside them (Shuraim's 12:75)", () => {
    const listed = qul(keys);
    listed.timings.set('40:14', { from: 12000, to: 22000, segments: [[1, 14000, 18000], [2, 23500, 26000], [3, 30000, 33000], [4, 35000, 36000]] });
    expect(chooseReciterTiming(keys, null, listed).published('40:14')).toEqual({ from: 12000, to: 22000, segments: undefined });
  });

});

describe('chooseReciterTiming between sources', () => {
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

  it("falls back to QUL's own recording only where that pairing was audited, and only when quran.com did not answer", () => {
    const audited = { timings: 'quran.com' as const, qulFallback: true };
    const down = chooseReciterTiming(keys, null, qul(keys), audited);
    expect(down.provider).toBe('qul');
    expect(down.audioUrl).toBe(qul(keys).audioUrl);
    // Not audited: no timings rather than QUL's on an unchecked pairing.
    expect(chooseReciterTiming(keys, null, qul(keys), { timings: 'quran.com' }).provider).toBeNull();
    // quran.com answered without covering the passage: the recording is still quran.com's.
    expect(chooseReciterTiming(keys, quranCom(['5:41']), qul(keys), audited).provider).toBeNull();
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
    // quran.com's own file, with QUL's own pairing audited as a fallback (timingFallbacks.json).
    expect(timingPair('sudais', 1)).toEqual({ timings: 'quran.com', qulFallback: true });
    // QUL's timings miss its own Al-Qasas file from about ayah 17 (audit 2026-10-10): no fallback.
    expect(timingPair('yasser', 28)).toEqual({ timings: 'quran.com' });
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

describe('pairedRecording', () => {
  const keys = ['40:1'];
  const qdc = quranCom(keys).audioUrl;
  const tarteel = qul(keys).audioUrl;

  it("is the audited source's recording, or the file the audit named", () => {
    expect(pairedRecording(quranCom(keys), qul(keys), { timings: 'quran.com' }, true)).toBe(qdc);
    expect(pairedRecording(quranCom(keys), qul(keys), { timings: 'qul' }, true)).toBe(tarteel);
    expect(pairedRecording(null, qul(keys), { timings: 'qul', audioUrl: qdc }, true)).toBe(qdc);
  });

  it('is unknown, not another recording, when the source that names it did not answer', () => {
    // quran.com down: Sudais must not drop to mp3quran's or QUL's file of the same surah.
    expect(() => pairedRecording(null, qul(keys), { timings: 'quran.com' }, true)).toThrow();
    expect(() => pairedRecording(null, qul(keys), undefined, true)).toThrow();
    expect(() => pairedRecording(quranCom(keys), null, { timings: 'qul' }, true)).toThrow();
    expect(pairedRecording(null, qul(keys), { timings: 'quran.com', qulFallback: true }, true)).toBe(tarteel);
    expect(() => pairedRecording(null, null, { timings: 'quran.com', qulFallback: true }, true)).toThrow();
  });

  it("leaves the reciter's own file only where nothing times the surah", () => {
    expect(pairedRecording(quranCom(keys), qul(keys), null, true)).toBeNull();
    expect(pairedRecording(null, null, undefined, false)).toBeNull();
    expect(pairedRecording(null, qul(keys), undefined, false)).toBe(tarteel);
  });

  it('puts the studio on the recording Load plays for the passage it opens on', () => {
    // The opening sample was mp3quran's Al-Fatihah while Load played quran.com's:
    // the same passage as two recitations. quran.com names this file for
    // Sudais (reciter 3) surah 1, as checked 2026-10-10.
    const sample = SAMPLE_PROJECTS[0];
    const named: QuranComTimings = {
      ...quranCom(['1:1']),
      audioUrl: 'https://download.quranicaudio.com/qdc/abdurrahmaan_as_sudais/murattal/1.mp3',
    };
    return import('./timingAudit').then(({ timingPair }) => {
      expect(pairedRecording(named, qul(['1:1']), timingPair(sample.reciterId, sample.surahNumber), true)).toBe(sample.audioUrl);
    });
  });
});
