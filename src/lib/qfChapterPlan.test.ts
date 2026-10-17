import { describe, it, expect } from 'vitest';
import {
  afterOpening, ayahBounds, ayahSegments, chapterPace, chapterProblems, chapterRecordsBySurah, cutStale, frameAt, framesMs,
  inPause, joinCut, levels, mergedSilences, MIN_AGREEMENT, mp3Frames, nextWindow, PAUSE_DEPTH_DB, qfAgrees, qfWordsFit, speechLevel,
} from '../../scripts/qf-chapter-plan.mjs';

/** An MPEG-1 layer III frame at 44.1 kHz, stereo: 417 bytes at 128 kb/s (bitrate index 9), 626 at 192 (11). */
function frame(bitrateIndex = 9, fill = 0x55, tag = '') {
  const size = Math.floor((144 * [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192][bitrateIndex] * 1000) / 44100);
  const bytes = new Uint8Array(size).fill(fill);
  bytes.set([0xff, 0xfb, bitrateIndex << 4, 0x00]);
  if (tag) bytes.set([...tag].map(c => c.charCodeAt(0)), 36);
  return bytes;
}
const joined = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};
const id3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 5, 1, 2, 3, 4, 5]);
const id3v1 = new Uint8Array(128).fill(0x20).map((byte, i) => (i < 3 ? 'TAG'.charCodeAt(i) : byte));

describe('the frames of a chapter recording', () => {
  it('are its audio frames only: no ID3 tags, no Xing frame', () => {
    const file = joined(id3, frame(9, 0, 'Info'), frame(), frame(), frame(), id3v1);
    const { frames, rate, samples, variable } = mp3Frames(file);
    expect(frames.map(f => f.offset)).toEqual([15 + 417, 15 + 2 * 417, 15 + 3 * 417]);
    expect(frames.every(f => f.size === 417)).toBe(true);
    expect([rate, samples, variable]).toEqual([44100, 1152, false]);
  });

  it('tell a variable bitrate from a constant one', () => {
    expect(mp3Frames(joined(frame(9, 0, 'Xing'), frame(9), frame(11), frame(9))).variable).toBe(true);
  });

  it('are not found in a stray sync word with no frame after it', () => {
    const noise = new Uint8Array(50).fill(0x11);
    noise.set([0xff, 0xfb, 0x90, 0x00], 10);
    expect(mp3Frames(joined(frame(), noise, frame(), frame())).frames).toHaveLength(2);
  });

  it('are counted as the player plays them, and cut at the nearest boundary', () => {
    expect(framesMs(3, 44100, 1152)).toBe(78.367);
    expect(framesMs(10, 22050, 576)).toBe(261.224);
    expect(frameAt(0.04, 44100, 1152)).toBe(2);
    expect(frameAt(-1, 44100, 1152)).toBe(0);
  });
});

describe('the loudness of a recording', () => {
  it('is measured every 20ms, in dB, integer samples scaled to -1..1', () => {
    const pcm = new Int16Array(16000).fill(16384);
    const db = levels(pcm, 16000, 0.02, 1 / 32768);
    expect(db).toHaveLength(50);
    expect(db[0]).toBeCloseTo(-6.02, 1);
  });

  it('puts the reciter at what 70% of the recording reaches, digital silence left out', () => {
    expect(speechLevel([-120, -120, -40, -30, -20, -10, -12, -11, -9, -13])).toBe(-11);
  });
});

/** Levels every 20ms: the reciter at -10 dB, with the stretches given. */
function track(seconds: number, ...stretches: [number, number, number][]) {
  const db = new Float32Array(Math.round(seconds / 0.02)).fill(-10);
  for (const [from, to, level] of stretches) for (let i = Math.round(from / 0.02); i < Math.round(to / 0.02); i++) db[i] = level;
  return db;
}

describe('a join between two ayahs', () => {
  it('is cut in the pause, giving the next ayah only its last 0.3s', () => {
    const db = track(4, [1, 2, -60]);
    const join = joinCut({ after: 0.3, nextStart: 2.02, db, silences: [[1.05, 1.95]] });
    expect(join.at).toBeCloseTo(1.68, 2);
    expect(join.depth).toBeGreaterThanOrEqual(PAUSE_DEPTH_DB);
    expect(inPause(join)).toBe(true);
  });

  it('leaves a held madd fading out with the ayah it ends', () => {
    // Al-Dossary's 32:15: the voice fades for two seconds, and the pause is the last moment before 32:16.
    const fading: [number, number, number][] = Array.from({ length: 20 }, (_, i) => [1 + i * 0.1, 1.1 + i * 0.1, -12 - i]);
    const db = track(4, ...fading, [3, 3.2, -60]);
    const join = joinCut({ after: 0.3, nextStart: 3.22, db, silences: [] });
    expect(join.at).toBeGreaterThanOrEqual(3);
    expect(join.at).toBeLessThan(3.22);
  });

  it('is not the hush of a stop consonant in the next ayah, however deep', () => {
    // Yasser ad-Dossary's 32:22-23: a 0.2 s pause at 30 dB down, then «وَلَقَدْ» with a 40 ms hush in it.
    const db = track(4, [2.1, 2.3, -40], [2.7, 2.74, -70]);
    const join = joinCut({ after: 0.3, nextStart: 2.42, db, silences: [[2.1, 2.3]] });
    expect(join.at).toBeGreaterThanOrEqual(2.1);
    expect(join.at).toBeLessThan(2.4);
  });

  it('where the reciter runs straight on, is at the word boundary, not a hush a second back inside the ayah before', () => {
    // Saad al-Ghamdi's short surahs: no pause between ayahs, a closure inside the last word 1 s before the next.
    const db = track(4, [1, 1.12, -30], [1.95, 2.0, -18]);
    const join = joinCut({ after: 0.3, nextStart: 2.02, db, silences: [] });
    expect(join.at).toBeGreaterThan(1.8);
    expect(join.at).toBeLessThan(2.1);
  });

  it('where one ayah runs into the next, is no pause at all', () => {
    const db = track(4, [1.9, 2, -16]);
    const join = joinCut({ after: 0.3, nextStart: 2.02, db, silences: [] });
    expect(inPause(join)).toBe(false);
    expect(join.at).toBeCloseTo(1.92, 1);
  });

});

describe('a pause between two ayahs', () => {
  it('takes digital silence and the near-silence beside it for one pause', () => {
    // Al-Muaiqly's 21:51-52: the room at -90 dB, then digital silence at -120, then 21:52.
    const db = track(6, [1, 3.5, -90], [3.5, 3.9, -120]);
    const join = joinCut({ after: 0.3, nextStart: 3.92, db, silences: [[1, 3.9]] });
    expect(join.from).toBeLessThanOrEqual(1.95);
    expect(join.until).toBeGreaterThan(3.8);
  });

  it('in a recording compressed close to its floor, is a pause where it reaches the floor', () => {
    // Ahmed al-Ajmy's: the voice at -10 dB, the room at -21, a pause between ayahs at it.
    const db = track(30, [0, 30, -10], [14, 14.6, -21], [3, 3.4, -21], [24, 24.4, -21]);
    const join = joinCut({ after: 10, nextStart: 14.62, db, silences: [[14, 14.6]] });
    expect(join.depth).toBeLessThan(PAUSE_DEPTH_DB);
    expect(inPause(join)).toBe(true);
    expect(inPause({ ...join, heard: false })).toBe(false);
  });

});

describe('the Foundation agreeing with a join', () => {
  it('is only within its own gap, 0.35s before it and 0.8s after, since its starts run early', () => {
    const before = { timestamp_from: 0, timestamp_to: 18040 };
    const after = { timestamp_from: 19160, timestamp_to: 28170 };
    expect(qfAgrees(18.5, before, after)).toBe(true);
    expect(qfAgrees(17.6, before, after)).toBe(false);
    expect(qfAgrees(19.9, before, after)).toBe(true);
    expect(qfAgrees(20.1, before, after)).toBe(false);
    expect(qfAgrees(18.5, undefined, after)).toBe(false);
  });

  it("reaches the next ayah's first word, which its timing often opens before", () => {
    // Abdullah Abu Sharida's 1:4-5: the timing opens at 26.7 s, its first word at 27.2 s.
    const before = { timestamp_from: 22750, timestamp_to: 25730 };
    const after = { timestamp_from: 26700, timestamp_to: 33120, segments: [[1, 27200, 28200]] };
    expect(qfAgrees(27.9, before, after)).toBe(true);
    expect(qfAgrees(28.1, before, after)).toBe(false);
  });

  it('counts the whole lull a join is cut in, and an ayah ending at its last word', () => {
    // Tahoun's 67:1-2: the timing closes at 15.92 s, its last word at 15.46 s; the cut 15.56 s, the lull to 15.9 s.
    const before = { timestamp_from: 0, timestamp_to: 15919, segments: [[9, 13626, 15460]] };
    const after = { timestamp_from: 15920, timestamp_to: 30000, segments: [[1, 16201, 16912]] };
    expect(qfAgrees({ at: 15.56, until: 15.9 }, before, after)).toBe(true);
    expect(qfAgrees({ at: 14.5, until: 14.9 }, before, after)).toBe(false);
  });

  it('agrees where its join is in the same silence as the cut, seconds before it', () => {
    // Al-Muaiqly's 21:51-52: 21:52's first word listed from 859.55 s; the cut at 861.4 s, in silence from 859.6 s.
    const before = { timestamp_from: 850000, timestamp_to: 858270, segments: [[9, 857110, 858270]] };
    const after = { timestamp_from: 859250, timestamp_to: 870000, segments: [[1, 859550, 861850]] };
    expect(qfAgrees({ at: 861.4, until: 861.44 }, before, after)).toBe(false);
    expect(qfAgrees({ at: 861.4, from: 859.6, until: 861.44 }, before, after)).toBe(true);
  });

});

describe('the first ayah', () => {
  it('after a basmala, starts in the first pause after it, not where the aligner starts the ayah', () => {
    // Al-Muaiqly's 32: basmala heard to 8.06s, الٓمٓ from 9.6s, which the aligner starts at 14.1s.
    const db = track(16, [8.1, 9.5, -60], [11, 11.3, -45]);
    const join = afterOpening({ openingEnd: 8.06, firstStart: 14.1, db, silences: [[8.1, 9.5]] });
    expect(join.at).toBeGreaterThan(8.1);
    expect(join.at).toBeLessThan(9.5);
    expect(join.depth).toBeGreaterThanOrEqual(PAUSE_DEPTH_DB);
  });

  it("takes the phoneme model's silences as one where only slivers part them", () => {
    expect(mergedSilences([[2, 3], [0, 1], [1.04, 1.5]])).toEqual([[0, 1.5], [2, 3]]);
  });
});

describe('the windows a chapter is aligned in', () => {
  const verse = (ayah: number, letters: number) => ({ ayah, words: ['ب'.repeat(letters)] });
  const verses = Array.from({ length: 40 }, (_, i) => verse(i + 1, 50));

  it('guess each ayah from the chapter pace', () => {
    expect(chapterPace([verse(1, 10), verse(2, 30)], 20)).toBe(0.5);
  });

  it('keep about a minute and read on past it', () => {
    const window = nextWindow({ verses, first: 0, from: 0, duration: 1000, pace: 0.5 });
    expect(window).toMatchObject({ first: 0, keep: 2, final: false });
    expect(window.last).toBeGreaterThan(window.keep);
    expect(window.to).toBeCloseTo((75 + 25) * 1.1 + 4);
  });

  it('take the rest in one once it is short, to the end of the recording', () => {
    expect(nextWindow({ verses, first: 36, from: 900, duration: 1000, pace: 0.5 })).toMatchObject({ first: 36, keep: 39, last: 39, to: 1000, final: true });
  });

  it('place each ayah from its words', () => {
    const words = [
      { verse_key: '32:1', word_index: 0, start: 5.1, end: 5.3 },
      { verse_key: '32:2', word_index: 0, start: 8.5, end: 9 },
      { verse_key: '32:2', word_index: 1, start: 9.1, end: 10 },
    ];
    expect(ayahBounds(words, 100).get(2)).toEqual({ start: 108.5, end: 110 });
  });
});

describe('a chapter cut', () => {
  const join = (ayah: number, extra = {}) => ({ ayah, at: ayah * 10, depth: 40, overFloor: 0, heard: true, qf: true, ...extra });
  const placed = (extra = {}) => ({
    windows: [{ from: 0, to: 40, agreement: 0.8 }],
    joins: [join(2), join(3)],
    cuts: [0, 20, 30],
    duration: 40,
    ...extra,
  });

  it('is kept when every check holds', () => {
    expect(chapterProblems(placed())).toEqual([]);
  });

  it('is not kept when a window did not read its text', () => {
    expect(chapterProblems(placed({ windows: [{ from: 0, to: 40, agreement: MIN_AGREEMENT - 0.1 }] }))).toHaveLength(1);
  });

  it('is not kept for a join that is neither a pause nor agreed by the Foundation', () => {
    expect(chapterProblems(placed({ joins: [join(2, { depth: 8, overFloor: 10, qf: false }), join(3)] }))[0]).toMatch(/before ayah 2/);
    expect(chapterProblems(placed({ joins: [join(2, { depth: 8 }), join(3, { heard: false })] }))).toEqual([]);
    expect(chapterProblems(placed({ joins: [join(1, { opening: true, qf: false }), join(2), join(3)] }))).toEqual([]);
  });

});

describe("a chapter cut against the Foundation's timings", () => {
  const join = (ayah: number, extra = {}) => ({ ayah, at: ayah * 10, depth: 40, overFloor: 0, heard: true, qf: true, ...extra });
  const placed = (extra = {}) => ({
    windows: [{ from: 0, to: 40, agreement: 0.8 }],
    joins: [join(2), join(3)],
    cuts: [0, 20, 30],
    duration: 40,
    ...extra,
  });

  it("on a recording the Foundation's timings fit, is not kept for a join they put elsewhere, however it sounds", () => {
    const joins = Array.from({ length: 10 }, (_, i) => join(i + 2));
    joins[4] = join(6, { qf: false });
    expect(chapterProblems(placed({ joins }))[0]).toMatch(/before ayah 6/);
  });

  it("keeps the aligner's pause where the Foundation's join is in the reciter's voice", () => {
    const joins = Array.from({ length: 10 }, (_, i) => join(i + 2));
    joins[4] = join(6, { qf: false, qfInVoice: true });
    expect(chapterProblems(placed({ joins }))).toEqual([]);
  });

  it("elsewhere, keeps a pause, or a run-on join read twice alike, unless the aligner tangled the two ayahs", () => {
    const elsewhere = { qf: false };
    expect(chapterProblems(placed({ joins: [join(2, elsewhere), join(3, elsewhere)] }))).toEqual([]);
    expect(chapterProblems(placed({ joins: [join(2, { ...elsewhere, tangled: true }), join(3, elsewhere)] }))).toHaveLength(1);
    const runOn = { ...elsewhere, depth: 8, overFloor: 10 };
    expect(chapterProblems(placed({ joins: [join(2, runOn), join(3, elsewhere)] }))).toHaveLength(1);
    expect(chapterProblems(placed({ joins: [join(2, { ...runOn, confirmed: true }), join(3, elsewhere)] }))).toEqual([]);
  });

  it('is not kept when two windows cut a join apart, or an ayah would be too short', () => {
    const apart = { secondCut: 20.4 };
    expect(chapterProblems(placed({ joins: [join(2, { ...apart, qf: false }), join(3, { qf: false })] }))[0]).toMatch(/at 20s from one window and at 20.4s/);
    expect(chapterProblems(placed({ joins: [join(2, { secondCut: 20.1, qf: false }), join(3, { qf: false })] }))).toEqual([]);
    expect(chapterProblems(placed({ joins: [join(2, apart), join(3)] }))).toEqual([]);
    expect(chapterProblems(placed({ cuts: [0, 20, 39.9] }))[0]).toMatch(/ayah 3 would be/);
  });

});

describe("a chapter cut's word timings", () => {
  const join = (ayah: number, extra = {}) => ({ ayah, at: ayah * 10, depth: 40, overFloor: 0, heard: true, qf: true, ...extra });

  it("are the Foundation's only where its joins fit the recording", () => {
    expect(qfWordsFit([join(2), join(3)])).toBe(true);
    expect(qfWordsFit([join(2), join(3, { qf: false })])).toBe(false);
  });

  it("are on each ayah's own file's clock", () => {
    const qf = { timestamp_from: 9610, timestamp_to: 18040, segments: [[1, '9610', '18040']] };
    expect(ayahSegments({ fromMs: 8800, ms: 10449, qf, words: [] })).toEqual([[1, 810, 9240]]);
    const words = [{ verse_key: '32:1', word_index: 1, start: 10, end: 10.5 }, { verse_key: '32:1', word_index: 0, start: 9.6, end: 30 }];
    expect(ayahSegments({ fromMs: 8800, ms: 10449, qf: null, words })).toEqual([[1, 800, 10449], [2, 1200, 1700]]);
  });
});

describe('a chapter cut kept in sync', () => {
  const file = (extra = {}) => ({
    record_type: 'chapter_audio_file', chapter_id: '32', audio_url: 'https://download.quranicaudio.com/quran/maher/032.mp3',
    file_size: '7058685', updated_at: '2026-08-29T07:36:34.598Z', ...extra,
  });
  const segment = (extra = {}) => ({ record_type: 'audio_segment', chapter_id: '32', updated_at: '2025-01-08T12:02:59.042Z', ...extra });
  const cut = { source: { url: file().audio_url, size: 7058685, cutAt: '2026-10-17T00:00:00Z' } };

  it("groups a snapshot's records by surah, one recording each, the one changed last", () => {
    const bySurah = chapterRecordsBySurah([
      file(), segment(), segment(), file({ chapter_id: null }), file({ audio_url: 'newer', updated_at: '2026-09-01T00:00:00Z' }),
    ]);
    expect([...bySurah.keys()]).toEqual([32]);
    expect(bySurah.get(32)?.file?.audio_url).toBe('newer');
    expect(bySurah.get(32)?.ayahs).toHaveLength(2);
  });

  it('is cut again only when the recording or its timings changed after the cut', () => {
    expect(cutStale(cut, { file: file(), ayahs: [segment()] })).toBe(false);
    expect(cutStale(cut, { file: file({ file_size: '1' }), ayahs: [] })).toBe(true);
    expect(cutStale(cut, { file: file(), ayahs: [segment({ updated_at: '2026-10-18T00:00:00Z' })] })).toBe(true);
    expect(cutStale(cut, { file: null, ayahs: [] })).toBe(true);
    expect(cutStale(null, { file: file(), ayahs: [] })).toBe(true);
  });
});
