import { describe, it, expect } from 'vitest';
import { byteRange, servedFile } from './servedFile';

describe('byteRange', () => {
  it('reads the ranges ffmpeg and the player ask for', () => {
    expect(byteRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
    expect(byteRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(byteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(byteRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('serves the whole file without a range, and refuses one past the end', () => {
    expect(byteRange(null, 1000)).toBeNull();
    expect(byteRange('bytes=1000-', 1000)).toBe('unsatisfiable');
  });
});

describe('servedFile', () => {
  it('has a file with an etag asked again each time, so one made again at the same address is not played from cache', () => {
    const file = { file: __filename, size: 10 };
    expect(servedFile(file, null, 'audio/mpeg').headers.get('cache-control')).toBe('public, max-age=86400');
    const tagged = servedFile({ ...file, etag: '"1-10"' }, null, 'audio/mpeg').headers;
    expect([tagged.get('cache-control'), tagged.get('etag')]).toEqual(['no-cache', '"1-10"']);
  });
});
