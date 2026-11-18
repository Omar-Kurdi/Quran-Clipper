import { describe, expect, it } from 'vitest';
import { fittedScale } from './panelFit';

describe('fittedScale', () => {
  it('grows the panel until its height or width meets the screen', () => {
    expect(fittedScale({ width: 768, height: 600 }, { width: 2560, height: 1440 })).toBe(2);
    expect(fittedScale({ width: 768, height: 600 }, { width: 1600, height: 1000 })).toBe(1.5);
    expect(fittedScale({ width: 768, height: 400 }, { width: 1200, height: 1000 })).toBe(1.5);
  });

  it('never draws it smaller than its own size, nor measures nothing', () => {
    expect(fittedScale({ width: 768, height: 900 }, { width: 800, height: 700 })).toBe(1);
    expect(fittedScale({ width: 0, height: 0 }, { width: 800, height: 700 })).toBe(1);
  });
});
