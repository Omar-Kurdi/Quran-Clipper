import { describe, expect, it } from 'vitest';
import { normalizeAudioTags, readAudioTags } from './audioTags';

const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const safe32 = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const utf8 = (text: string) => [...new TextEncoder().encode(text)];
/** UTF-16 with a little-endian byte order mark, as most taggers write 2.3. */
const utf16 = (text: string) => [0xff, 0xfe, ...[...text].flatMap(c => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])];

/** A whole tag of `version` holding these frames, each as [id, encoding, text bytes]. */
function tag(version: 2 | 3 | 4, frames: [string, number, number[]][], flags = 0) {
  const body = frames.flatMap(([id, encoding, text]) => {
    const data = [encoding, ...text];
    const size = version === 2 ? [(data.length >> 16) & 0xff, (data.length >> 8) & 0xff, data.length & 0xff]
      : version === 4 ? safe32(data.length) : be32(data.length);
    return [...utf8(id), ...size, ...(version === 2 ? [] : [0, 0]), ...data];
  });
  return Uint8Array.from([0x49, 0x44, 0x33, version, 0, flags, ...safe32(body.length + 16), ...body, ...new Array(16).fill(0)]);
}

describe('readAudioTags', () => {
  it("reads a 2.3 tag's UTF-16 artist and title, and the surah from the track number", () => {
    const bytes = tag(3, [['TPE1', 1, utf16('علاء عقل')], ['TIT2', 1, utf16('سورة الحجرات')], ['TRCK', 0, utf8('049')]]);
    expect(readAudioTags(bytes)).toEqual({ artist: 'علاء عقل', title: 'سورة الحجرات', track: 49 });
  });

  it("reads a 2.4 tag's UTF-8 frames, sized synchsafe, past 127 bytes", () => {
    const long = 'x'.repeat(150);
    const bytes = tag(4, [['TALB', 3, utf8(long)], ['TRCK', 3, utf8('2/114')], ['TPE1', 3, utf8('Reciter')]]);
    expect(readAudioTags(bytes)).toEqual({ album: long, track: 2, artist: 'Reciter' });
  });

  it('reads 2.2, whose ids are three letters', () => {
    expect(readAudioTags(tag(2, [['TP1', 0, utf8('Name')], ['TRK', 0, utf8('112')]]))).toEqual({ artist: 'Name', track: 112 });
  });

  it('takes the first of several values', () => {
    expect(readAudioTags(tag(4, [['TPE1', 3, utf8('One\u0000Two')]]))).toEqual({ artist: 'One' });
  });

  it('is nothing without a tag, or with none of these frames', () => {
    expect(readAudioTags(new Uint8Array([0xff, 0xfb, 0x90, 0x64]))).toBeNull();
    expect(readAudioTags(tag(3, [['COMM', 0, utf8('eng\u0000hello')]]))).toBeNull();
  });

  it('stops at a frame that runs past the tag rather than reading past it', () => {
    const bytes = tag(3, [['TPE1', 0, utf8('Name')]]);
    bytes.set(be32(9999), 14);
    expect(readAudioTags(bytes)).toBeNull();
  });
});

describe('normalizeAudioTags', () => {
  it('keeps what is read here and drops the rest', () => {
    expect(normalizeAudioTags({ artist: ' A ', track: 49, cover: 'x', title: 3 })).toEqual({ artist: 'A', track: 49 });
    expect(normalizeAudioTags({ track: 0 })).toBeNull();
    expect(normalizeAudioTags({ folder: ' Alaa-Aqel ' })).toEqual({ folder: 'Alaa-Aqel' });
    expect(normalizeAudioTags('artist')).toBeNull();
  });
});

describe('normalizeAudioTags, the recording a clip was cut from', () => {
  it('keeps a source that is a SHA-256, and drops anything else', () => {
    const source = '0123456789abcdef'.repeat(4);
    expect(normalizeAudioTags({ source })).toEqual({ source });
    expect(normalizeAudioTags({ artist: 'x', source: 'not-a-hash' })).toEqual({ artist: 'x' });
    expect(normalizeAudioTags({ source: source.toUpperCase() })).toBeNull();
  });

  it('keeps which clip of the old layout a clip project was made from, and that it is a clip', () => {
    expect(normalizeAudioTags({ clip: true, windowOf: 'proj_1795206759505_7elv0/clip-mwp2p6uq-1' }))
      .toEqual({ clip: true, windowOf: 'proj_1795206759505_7elv0/clip-mwp2p6uq-1' });
    expect(normalizeAudioTags({ clip: 'yes', windowOf: '../../etc' })).toBeNull();
  });
});
