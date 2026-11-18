import { describe, expect, it } from 'vitest';
import { formatStamp } from './stamp';

describe('formatStamp', () => {
  const at = new Date(2026, 10, 18, 6, 33).toISOString();

  it('gives the day, month, year and a 24-hour time', () => {
    expect(formatStamp(at, 'en')).toBe('18 Nov 2026, 06:33');
  });

  it('leaves the year out when short', () => {
    expect(formatStamp(at, 'en', true)).toBe('18 Nov, 06:33');
  });

  it('is empty for anything that is not a time', () => {
    expect(formatStamp(null, 'en')).toBe('');
    expect(formatStamp('not a date', 'en')).toBe('');
  });
});
