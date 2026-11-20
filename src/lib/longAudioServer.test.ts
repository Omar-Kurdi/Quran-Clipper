import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readEnvelope } from './longAudioServer';
import { findFfmpeg } from './renderRunner';

const ffmpeg = findFfmpeg();

/** The serial number of every Ogg page in `bytes`, in order. */
function oggSerials(bytes: Buffer): number[] {
  const serials: number[] = [];
  for (let at = 0; at + 27 <= bytes.length;) {
    expect(bytes.toString('latin1', at, at + 4)).toBe('OggS');
    const segments = bytes[at + 26];
    let size = 27 + segments;
    for (let i = 0; i < segments; i++) size += bytes[at + 27 + i];
    serials.push(bytes.readUInt32LE(at + 14));
    at += size;
  }
  return serials;
}

// Needs ffmpeg itself: what is tested is the copy it writes.
describe.skipIf(!ffmpeg)('the copy of a long recording to listen to', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qc-listen-test-'));
  const source = path.join(dir, 'source.wav');
  beforeAll(() => {
    execFileSync(ffmpeg!, ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=40', source]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('stays one stream when two reads of the recording run at once', async () => {
    const listen = path.join(dir, 'copy.ogg');

    const [first, second] = await Promise.all([
      readEnvelope(ffmpeg!, source, listen),
      readEnvelope(ffmpeg!, source, listen),
    ]);

    expect(first.duration).toBeCloseTo(40, 1);
    expect(second.duration).toBeCloseTo(first.duration, 3);
    // Two random serials in one copy is where the browser stopped playing it.
    const serials = oggSerials(readFileSync(listen));
    expect(serials.length).toBeGreaterThan(10);
    expect(new Set(serials).size).toBe(1);
    // Nothing half-written is left beside it.
    expect(readdirSync(dir).filter(name => name.endsWith('.part'))).toEqual([]);
  });

  // Which read's pages end up where depends on timing, so this is what keeps two reads from mixing: they are the same bytes.
  it('writes the same bytes on every read, so a copy replaced mid-play still fits', async () => {
    const listen = path.join(dir, 'again.ogg');
    await readEnvelope(ffmpeg!, source, listen);
    const once = readFileSync(listen);
    await readEnvelope(ffmpeg!, source, listen);
    expect(readFileSync(listen).equals(once)).toBe(true);
  });
});
