import { describe, expect, it } from 'vitest';
import { isVbrMp3, looksLikeMp3 } from './seekableAudio';

/** An MPEG-1 Layer III stereo frame header, then its side information, then `tag` where a Xing header goes. */
function frame(tag: string, at = 36) {
  const bytes = new Uint8Array(200);
  bytes.set([0xff, 0xfb, 0x90, 0x64]);
  bytes.set([...tag].map(c => c.charCodeAt(0)), at);
  return bytes;
}

/** An ID3v2 tag of `size` bytes, its size synchsafe as the format has it, before `rest`. */
function withId3(size: number, rest: Uint8Array) {
  const head = [0x49, 0x44, 0x33, 4, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f];
  const out = new Uint8Array(10 + size + rest.length);
  out.set(head);
  out.set(rest, 10 + size);
  return out;
}

describe('isVbrMp3', () => {
  it('finds the Xing header of a variable-bitrate file', () => {
    expect(isVbrMp3(frame('Xing'))).toBe(true);
  });

  it("does not take a constant-bitrate file's Info header, or none, for one", () => {
    expect(isVbrMp3(frame('Info'))).toBe(false);
    expect(isVbrMp3(frame(''))).toBe(false);
  });

  it('reads past an ID3 tag, even one larger than 127 bytes', () => {
    expect(isVbrMp3(withId3(30_000, frame('Xing')))).toBe(true);
    expect(isVbrMp3(withId3(30_000, frame('Info')))).toBe(false);
  });

  it('finds a Fraunhofer VBRI header too', () => {
    expect(isVbrMp3(frame('VBRI', 36))).toBe(true);
  });

  it('says no for what is not an MP3', () => {
    expect(isVbrMp3(new TextEncoder().encode('RIFF....WAVEfmt '))).toBe(false);
    expect(isVbrMp3(new Uint8Array(0))).toBe(false);
  });
});

describe('looksLikeMp3', () => {
  it('goes by the type, and by the name only where there is no type', () => {
    expect(looksLikeMp3({ name: 'a.bin', type: 'audio/mpeg' })).toBe(true);
    expect(looksLikeMp3({ name: '049.MP3', type: '' })).toBe(true);
    expect(looksLikeMp3({ name: 'a.mp3', type: 'audio/wav' })).toBe(false);
  });
});
