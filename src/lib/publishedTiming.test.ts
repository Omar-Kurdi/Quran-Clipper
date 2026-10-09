import { describe, it, expect } from 'vitest';
import { estimatesFrom } from './publishedTiming';
import type { TimingChoice } from './reciterTimingChoice';

describe('estimatesFrom', () => {
  const choice: TimingChoice = {
    provider: 'quran.com',
    audioUrl: 'https://download.quranicaudio.com/qdc/saud_ash-shuraym/murattal/012.mp3',
    totalSeconds: 1506,
    boundsFor: key => (key === '12:75' ? { start: 1000.029, end: 1010.579 } : null),
    published: () => null,
  };

  it('starts the estimates of a passage past believing at its first ayah’s published start, not at 0s', () => {
    expect(estimatesFrom(null, choice, { verse_key: '12:75' })).toBe(1000.029);
  });

  it('is 0 when the load has bounds of its own, or nothing to place', () => {
    expect(estimatesFrom(new Map([['12:75', { start: 1000, end: 1010.6 }]]), choice, { verse_key: '12:75' })).toBe(0);
    expect(estimatesFrom(null, choice, { verse_key: '12:74' })).toBe(0);
    expect(estimatesFrom(null, choice, undefined)).toBe(0);
  });
});
