import { describe, it, expect } from 'vitest';
import {
  lengthCheck, bestLag, edgeCheck, fallbackColour, isFallback, patchChange, backgroundCheck,
  type BackgroundSample, type Patch
} from './renderCheck';

/** A recitation-like envelope: bursts of sound between pauses, never periodic. */
function envelope(seconds: number, rate: number, seed = 7): number[] {
  let state = seed;
  const random = () => ((state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const out: number[] = [];
  while (out.length < seconds * rate) {
    const word = Math.round((0.2 + random() * 0.6) * rate);
    const pause = Math.round((0.05 + random() * 0.4) * rate);
    const loud = 0.3 + random() * 0.7;
    for (let i = 0; i < word; i++) out.push(loud * (0.6 + 0.4 * Math.sin((i / word) * Math.PI)));
    for (let i = 0; i < pause; i++) out.push(0.02 * random());
  }
  return out.slice(0, seconds * rate);
}

describe('lengthCheck', () => {
  it('accepts a frame of rounding', () => {
    expect(lengthCheck(12.03, 12, 30).state).toBe('ok');
  });
  it('flags a render shorter than the trim', () => {
    expect(lengthCheck(11.4, 12, 30)).toMatchObject({ state: 'problem', measured: 11.4, expected: 12 });
  });
  it('cannot judge a length it could not read', () => {
    expect(lengthCheck(Infinity, 12, 30).state).toBe('unsure');
  });
});

describe('bestLag', () => {
  it('finds where a stretch came from', () => {
    const source = envelope(10, 50);
    expect(bestLag(source, source.slice(123, 323), 0, 300).lag).toBe(123);
  });
});

describe('edgeCheck', () => {
  const rate = 50;
  const source = envelope(60, rate);
  const range = { start: 20, end: 40 };

  it('passes a render that starts and ends at the trim', () => {
    const rendered = source.slice(range.start * rate, range.end * rate);
    expect(edgeCheck('start', source, rendered, rate, range).state).toBe('ok');
    expect(edgeCheck('end', source, rendered, rate, range).state).toBe('ok');
  });

  it('measures a beginning cut off', () => {
    // The render began 0.8s after the trim did.
    const rendered = source.slice((range.start + 0.8) * rate, range.end * rate);
    const start = edgeCheck('start', source, rendered, rate, range);
    expect(start.state).toBe('problem');
    expect(start.measured).toBeCloseTo(20.8, 1);
  });

  it('measures an end cut short', () => {
    const rendered = source.slice(range.start * rate, (range.end - 1) * rate);
    const end = edgeCheck('end', source, rendered, rate, range);
    expect(end.state).toBe('problem');
    expect(end.measured).toBeCloseTo(39, 1);
  });

  it('says it cannot tell over silence', () => {
    const quiet = new Array(60 * rate).fill(0.01);
    expect(edgeCheck('start', quiet, quiet.slice(1000, 2000), rate, range).state).toBe('unsure');
  });
});

describe('the fallback gradient', () => {
  it('is the top stop at the top, darkened by the overlay', () => {
    expect(fallbackColour(0, 0)).toEqual([15, 23, 42]);
    expect(fallbackColour(1, 0)).toEqual([30, 27, 75]);
    expect(fallbackColour(0.25, 0)).toEqual([8.5, 14.5, 32.5]);
    expect(fallbackColour(0, 100)).toEqual([2, 6, 23]);
  });

  it('is recognised in a patch, and footage is not', () => {
    const heights = [0.3, 0.5, 0.7];
    const plain: Patch = heights.map(y => fallbackColour(y, 40).map(c => c + 2));
    const footage: Patch = [[80, 60, 40], [90, 70, 50], [60, 50, 40]];
    expect(isFallback(plain, heights, 40)).toBe(true);
    expect(isFallback(footage, heights, 40)).toBe(false);
  });
});

describe('backgroundCheck', () => {
  const heights = [0.3, 0.5, 0.7];
  const plain: Patch = heights.map(y => fallbackColour(y, 40));
  const frame = (shade: number): Patch => [[shade, 60, 40], [shade, 70, 50], [shade, 50, 40]];
  const moving = (count: number, expected: BackgroundSample['expected'] = 'video'): BackgroundSample[] =>
    Array.from({ length: count }, (_, i) => ({ time: i, patch: frame(100 + i * 5), expected }));

  it('passes a background that is there and moving', () => {
    expect(backgroundCheck(moving(10), 1, heights, 40)).toMatchObject({ state: 'ok', spans: [] });
  });

  it('finds where the gradient replaced the clip', () => {
    const samples = moving(10);
    samples[4].patch = plain;
    samples[5].patch = plain;
    expect(backgroundCheck(samples, 1, heights, 40).spans).toEqual([{ kind: 'missing', start: 4, end: 6 }]);
  });

  it('ends a span at the end of the render, not a step past it', () => {
    const samples = moving(10);
    samples[9].patch = plain;
    expect(backgroundCheck(samples, 1, heights, 40, 9.4).spans).toEqual([{ kind: 'missing', start: 9, end: 9.4 }]);
  });

  it('does not report the gradient through a gap the lane has', () => {
    const samples = moving(6);
    samples[2] = { time: 2, patch: plain, expected: 'none' };
    expect(backgroundCheck(samples, 1, heights, 40).state).toBe('ok');
  });

  it('finds a clip that froze for several seconds, but not a brief hold', () => {
    const froze = moving(12);
    for (let i = 3; i <= 7; i++) froze[i].patch = frame(80);
    expect(backgroundCheck(froze, 1, heights, 40).spans).toEqual([{ kind: 'still', start: 3, end: 7 }]);

    const held = moving(12);
    held[5].patch = held[4].patch;
    expect(backgroundCheck(held, 1, heights, 40).state).toBe('ok');
  });

  it('never calls a still image frozen', () => {
    const image = Array.from({ length: 8 }, (_, i) => ({ time: i, patch: frame(80), expected: 'image' as const }));
    expect(backgroundCheck(image, 1, heights, 40).state).toBe('ok');
  });

  it('measures change between patches', () => {
    expect(patchChange(frame(80), frame(80))).toBe(0);
    expect(patchChange(frame(80), frame(89))).toBe(3);
  });
});
