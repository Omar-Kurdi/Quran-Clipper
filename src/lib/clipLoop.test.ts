import { describe, it, expect } from 'vitest';
import { findLoopWindow, loopFor, loopPhase, MAX_EDGE_SEC } from './clipLoop';

/** A clip that is black before `pictureFrom` and from `blackFrom` on. */
const clip = (pictureFrom: number, blackFrom: number) => async (seconds: number) =>
  seconds < pictureFrom || seconds >= blackFrom;

describe('findLoopWindow', () => {
  it('trims the black tail the Fatir 35:5-7 background ends on', async () => {
    const loop = await findLoopWindow(40.84, clip(0, 40.37));
    expect(loop.start).toBe(0);
    expect(loop.end).toBeLessThan(40.37);
    expect(loop.end).toBeGreaterThan(40.37 - 0.005);
  });

  it('trims a black opening', async () => {
    const loop = await findLoopWindow(12, clip(0.6, 99));
    expect(loop.start).toBeGreaterThanOrEqual(0.6);
    expect(loop.start).toBeLessThan(0.605);
    expect(loop.end).toBe(12);
  });

  it('leaves a clip with a picture at both ends whole, after two looks', async () => {
    const asked: number[] = [];
    const loop = await findLoopWindow(15, async seconds => { asked.push(seconds); return false; });
    expect(loop).toEqual({ start: 0, end: 15 });
    expect(asked).toHaveLength(2);
  });

  it('keeps darkness that runs longer than an edge: that clip is meant to be dark', async () => {
    expect(await findLoopWindow(20, clip(0, 20 - MAX_EDGE_SEC - 0.5))).toEqual({ start: 0, end: 20 });
  });

  it('keeps the whole clip when trimming would leave almost nothing', async () => {
    expect(await findLoopWindow(1.8, clip(0.5, 1.2))).toEqual({ start: 0, end: 1.8 });
  });
});

describe('loopPhase', () => {
  it('loops inside the window, never into the trimmed black', () => {
    const loop = { start: 0, end: 40.36 };
    expect(loopPhase(loop, 40.5)).toBeCloseTo(0.14);
    expect(loopPhase(loop, 10)).toBe(10);
  });

  it('starts each pass at the first frame with a picture', () => {
    expect(loopPhase({ start: 0.6, end: 12 }, 0)).toBe(0.6);
    expect(loopPhase({ start: 0.6, end: 12 }, 11.4)).toBeCloseTo(0.6);
  });

  it('is the plain modulo for a whole clip', () => {
    expect(loopPhase({ start: 0, end: 8 }, 19)).toBe(3);
  });
});

describe('loopFor', () => {
  it('uses a window measured for this clip', () => {
    expect(loopFor({ start: 0, end: 40.3 }, 40.84)).toEqual({ start: 0, end: 40.3 });
  });

  it('distrusts a window that does not fit the clip, and loops it whole', () => {
    // A host without byte ranges had the element report about five seconds of a forty-second file.
    expect(loopFor({ start: 0, end: 5 }, 40.84)).toEqual({ start: 0, end: 40.84 });
    expect(loopFor({ start: 3, end: 40 }, 40.84)).toEqual({ start: 0, end: 40.84 });
  });

  it('loops whole when nothing was measured', () => {
    expect(loopFor(null, 12)).toEqual({ start: 0, end: 12 });
    expect(loopFor(undefined, 12)).toEqual({ start: 0, end: 12 });
  });
});
