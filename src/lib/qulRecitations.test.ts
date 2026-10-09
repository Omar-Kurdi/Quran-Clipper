import { describe, it, expect } from 'vitest';
import { parseExport, withCorrections } from './qulRecitations';

/** The two files of a QUL surah-by-surah export, as its exporter writes them. */
const surahs = {
  '1': { surah_number: 1, audio_url: 'https://audio.example/ghamdi/001.mp3', duration: 47 }
};
const segments = {
  '1:1': { segments: [[1, 361, 1051], [2, 1051, 1622]], duration_sec: 4, duration_ms: 4224, timestamp_from: 361, timestamp_to: 4585 },
  '1:2': { segments: [], duration_sec: 5, duration_ms: 5000, timestamp_from: 4585, timestamp_to: 9585 }
};

describe('parseExport', () => {
  it('reads the audio of each surah and the timing of each ayah', () => {
    const parsed = parseExport(surahs, segments);
    expect(parsed?.audio.get(1)).toBe('https://audio.example/ghamdi/001.mp3');
    expect(parsed?.timings.get('1:1')).toEqual({
      from: 361,
      to: 4585,
      segments: [[1, 361, 1051], [2, 1051, 1622]]
    });
  });

  it('keeps an ayah with bounds but no word segments, as bounds only', () => {
    expect(parseExport(surahs, segments)?.timings.get('1:2')).toEqual({ from: 4585, to: 9585, segments: undefined });
  });

  it('refuses an audio address the player should not be pointed at', () => {
    const local = { '1': { surah_number: 1, audio_url: 'file:///etc/passwd' } };
    expect(parseExport(local, segments)).toBeNull();
  });

  it('is nothing when either file is missing', () => {
    // An export without its audio cannot be used: the timings belong to it.
    expect(parseExport(null, segments)).toBeNull();
    expect(parseExport(surahs, null)).toBeNull();
  });

  it('drops malformed entries rather than the whole export', () => {
    const parsed = parseExport(surahs, {
      ...segments,
      'not a key': { timestamp_from: 1, timestamp_to: 2 },
      '1:3': { timestamp_from: 'soon' }
    });
    expect([...(parsed?.timings.keys() || [])]).toEqual(['1:1', '1:2']);
  });
});

describe('withCorrections', () => {
  const retimed = { from: 300, to: 4500, segments: [[1, 300, 1000], [2, 1000, 1600]] };

  it('puts the re-timed ayahs in place of the export\u2019s', () => {
    const fixes = { audio: { '1': 'https://audio.example/ghamdi/001.mp3' }, ayahs: { '1:1': retimed } };
    const held = withCorrections(parseExport(surahs, segments), fixes);
    expect(held?.timings.get('1:1')).toEqual(retimed);
    expect(held?.timings.get('1:2')).toEqual({ from: 4585, to: 9585, segments: undefined });
  });

  it('leaves an export alone whose recording is not the one they were measured on', () => {
    const fixes = { audio: { '1': 'https://audio.example/another/001.mp3' }, ayahs: { '1:1': retimed } };
    expect(withCorrections(parseExport(surahs, segments), fixes)?.timings.get('1:1')?.from).toBe(361);
  });
});
