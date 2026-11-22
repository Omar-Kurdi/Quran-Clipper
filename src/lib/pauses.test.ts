import { describe, expect, it } from 'vitest';
import { envelopeOf, findPauses, longestPauseIn, pauseNear, quietLevel, snapToPauses } from './pauses';

/** An envelope at 50 a second: `voice` loud for each [from, to) span given, a quiet floor everywhere else. */
function envelope(seconds: number, spans: [number, number][], floor = 3, voice = 180): Uint8Array {
  const values = new Uint8Array(seconds * 50).fill(floor);
  for (const [from, to] of spans) values.fill(voice, from * 50, to * 50);
  return values;
}

describe('findPauses', () => {
  it('finds the quiet between recited stretches, not a dip shorter than a breath', () => {
    // Voice 0-4 s, a 1.2 s pause, voice 5.2-9 s with a 0.1 s gap at 7 s, a pause, voice to the end.
    const env = envelope(14, [[0, 4], [5.2, 7], [7.1, 9], [10, 14]]);
    expect(findPauses(env)).toEqual([{ start: 4, end: 5.2 }, { start: 9, end: 10 }]);
  });

  it('measures quiet against the recording, so room tone or a hum is still a pause', () => {
    const env = envelope(6, [[0, 2], [3, 6]], 40, 200);
    expect(findPauses(env)).toEqual([{ start: 2, end: 3 }]);
  });

  it('counts quiet at either end of the recording', () => {
    const env = envelope(6, [[1, 5]]);
    expect(findPauses(env)).toEqual([{ start: 0, end: 1 }, { start: 5, end: 6 }]);
  });

  it('finds none in a recording with no quiet', () => {
    expect(findPauses(new Uint8Array(500).fill(150))).toEqual([]);
  });

  it('sets the quiet level between the floor and the voice, not at either', () => {
    const level = quietLevel(envelope(10, [[0, 8]], 5, 205));
    expect(level).toBeGreaterThan(5);
    expect(level).toBeLessThan(60);
  });
});

describe('pauseNear and longestPauseIn', () => {
  const pauses = [{ start: 4, end: 5 }, { start: 9, end: 9.4 }, { start: 20, end: 22 }];

  it('gives the middle of the nearest pause within reach, or nothing', () => {
    expect(pauseNear(pauses, 8.8, 1)).toBe(9.2);
    expect(pauseNear(pauses, 4.6, 1)).toBe(4.5);
    expect(pauseNear(pauses, 15, 2)).toBeNull();
  });

  it('gives the longest pause wholly inside a stretch', () => {
    expect(longestPauseIn(pauses, 3, 10)).toEqual({ start: 4, end: 5 });
    expect(longestPauseIn(pauses, 21, 30)).toBeNull();
  });
});

describe('snapToPauses and envelopeOf', () => {
  const pauses = [{ start: 4, end: 5 }, { start: 20, end: 21 }, { start: 40, end: 41 }];

  it('moves each end of a stretch to the pause near it', () => {
    expect(snapToPauses(pauses, 5.8, 19.2)).toEqual({ start: 4.5, end: 20.5 });
    // Dragged right to left, too.
    expect(snapToPauses(pauses, 19.2, 5.8)).toEqual({ start: 4.5, end: 20.5 });
  });

  it('leaves an end with no pause near it where it is, and gives nothing when neither moves', () => {
    expect(snapToPauses(pauses, 5.8, 30)).toEqual({ start: 4.5, end: 30 });
    expect(snapToPauses(pauses, 10, 30)).toBeNull();
  });

  it('reads a peak per step of the samples, as the server does', () => {
    const samples = new Float32Array(400);
    samples[10] = -0.5;
    samples[250] = 1;
    expect(Array.from(envelopeOf(samples, 10000, 50))).toEqual([128, 255]);
  });
});
