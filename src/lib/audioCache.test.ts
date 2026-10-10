import { mkdtempSync, readdirSync } from 'node:fs';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { byteRange, cachedAudio, fillAudioCache } from './audioCache';

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

describe('fillAudioCache', () => {
  it('keeps a whole recording, and not one the CDN cut short', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'qc-cache-test-'));
    process.env.QC_AUDIO_CACHE_DIR = dir;
    // A stream that ends cleanly after `bytes` of a recording said to be `length` long.
    const answer = (bytes: number, length: number) => async () => {
      const res = new IncomingMessage(new Socket());
      res.statusCode = 200;
      res.headers = { 'content-length': String(length) };
      res.push(Buffer.alloc(bytes));
      res.push(null);
      return res;
    };
    const whole = 'https://download.quranicaudio.com/qdc/x/1.mp3';
    const cut = 'https://download.quranicaudio.com/qdc/x/2.mp3';
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fillAudioCache(whole, answer(100, 100));
    fillAudioCache(cut, answer(60, 100));

    await vi.waitFor(() => expect(cachedAudio(whole)?.size).toBe(100));
    await vi.waitFor(() => expect(readdirSync(dir).filter(name => name.endsWith('.part'))).toEqual([]));
    expect(cachedAudio(cut)).toBeNull();
  });
});
