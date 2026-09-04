import { describe, it, expect } from 'vitest';
import { accumulateStarvation, exportVerdict, emptyHealth } from './exportHealth';

const TARGET = 60;

describe('accumulateStarvation', () => {
  it('counts a backgrounded tab as starved', () => {
    // The case this exists for: rAF stops firing, so the canvas is painted
    // roughly once a second while the audio keeps running at real time.
    const health = accumulateStarvation(emptyHealth(), 1, 1, TARGET);
    expect(health.starvedSeconds).toBe(1);
    expect(health.recordedSeconds).toBe(1);
  });

  it('does not count a healthy render', () => {
    const health = accumulateStarvation(emptyHealth(), 30, 0.5, TARGET);
    expect(health.starvedSeconds).toBe(0);
    expect(health.recordedSeconds).toBe(0.5);
  });

  it('does not call a slow machine starved', () => {
    // 20 fps against a 60 fps request is a loaded GPU, not a stall. Calling it
    // starved would warn on every export from a modest machine and the warning
    // would stop meaning anything.
    const health = accumulateStarvation(emptyHealth(), 20, 1, TARGET);
    expect(health.starvedSeconds).toBe(0);
  });

  it('ignores a sample covering no audio', () => {
    // Timer ticks can outpace the audio clock's resolution; a zero-length
    // sample says nothing about the render and would divide by zero.
    const before = emptyHealth();
    expect(accumulateStarvation(before, 5, 0, TARGET)).toBe(before);
  });

  it('accumulates across samples', () => {
    let health = emptyHealth();
    health = accumulateStarvation(health, 60, 1, TARGET);
    health = accumulateStarvation(health, 1, 1, TARGET);
    health = accumulateStarvation(health, 1, 1, TARGET);
    expect(health.recordedSeconds).toBe(3);
    expect(health.starvedSeconds).toBe(2);
  });
});

describe('exportVerdict', () => {
  it('calls a second of frozen picture frozen', () => {
    const health = { ...emptyHealth(), recordedSeconds: 30, starvedSeconds: 1, effectiveFps: 58 };
    expect(exportVerdict(health, TARGET)).toBe('frozen');
  });

  it('forgives a hitch shorter than a second', () => {
    // Every render drops a few frames as it starts. Warning about those would
    // train the user to ignore the warning.
    const health = { ...emptyHealth(), recordedSeconds: 30, starvedSeconds: 0.4, effectiveFps: 58 };
    expect(exportVerdict(health, TARGET)).toBe('clean');
  });

  it('calls a sustained shortfall choppy rather than frozen', () => {
    const health = { ...emptyHealth(), recordedSeconds: 30, starvedSeconds: 0, effectiveFps: 25 };
    expect(exportVerdict(health, TARGET)).toBe('choppy');
  });

  it('is clean when the render kept up', () => {
    const health = { ...emptyHealth(), recordedSeconds: 30, starvedSeconds: 0, effectiveFps: 59 };
    expect(exportVerdict(health, TARGET)).toBe('clean');
  });

  it('does not call an export that recorded nothing choppy', () => {
    expect(exportVerdict(emptyHealth(), TARGET)).toBe('clean');
  });

  it('judges against the rate that was asked for', () => {
    // 25 fps is fine for a 30 fps export and bad for a 60 fps one.
    const health = { ...emptyHealth(), recordedSeconds: 30, starvedSeconds: 0, effectiveFps: 25 };
    expect(exportVerdict(health, 30)).toBe('clean');
    expect(exportVerdict(health, 60)).toBe('choppy');
  });
});
