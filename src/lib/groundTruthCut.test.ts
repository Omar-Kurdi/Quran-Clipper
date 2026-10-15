import { describe, it, expect } from 'vitest';
import { recordingOf } from './groundTruthCut';

describe('recordingOf', () => {
  it("reads a reciter passage's address, from this studio on any origin", () => {
    const passage = '/api/audio/ayahs?reciter=qf-3&surah=12&start=46&end=47';
    expect(recordingOf(passage)).toEqual({ reciterId: 'qf-3', surah: 12, start: 46, end: 47 });
    expect(recordingOf(`http://localhost:3000${passage}`)?.surah).toBe(12);
  });

  it('refuses anything else: another path, an unknown reciter, a range out of order', () => {
    expect(recordingOf('https://example.com/a.mp3')).toBeNull();
    expect(recordingOf('/api/audio/proxy?url=http%3A%2F%2F127.0.0.1%3A8000%2Fhealth')).toBeNull();
    expect(recordingOf('/api/audio/ayahs?reciter=nobody&surah=1&start=1&end=7')).toBeNull();
    expect(recordingOf('/api/audio/ayahs?reciter=qf-3&surah=1&start=5&end=2')).toBeNull();
    expect(recordingOf('not a url at all ::')).toBeNull();
  });
});
