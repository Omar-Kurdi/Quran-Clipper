'use client';

import { useEffect, useState } from 'react';
import { audioBufferToWav, decodeAudioFile } from '@/lib/audioTrim';
import { isVbrMp3, looksLikeMp3, SEEKABLE_COPY_MAX_SEC } from '@/lib/seekableAudio';

/** The start of a file: room for a large ID3 tag, cover art and all, and the first frame after it. */
const HEAD_BYTES = 1 << 20;

/**
 * A copy of an uploaded variable-bitrate MP3 for the `<audio>` element to
 * play, as a WAV of the same decode, which seeks exactly (`seekableAudio.ts`);
 * null for any other upload, until the copy is made, and when it cannot be.
 *
 * Only the element plays it. The upload itself is still what is stored, sent
 * to the aligner and exported, and those decode it whole -- on the clock this
 * copy is on.
 */
export function useSeekableUpload(file: File | null, duration: number): { file: File; url: string } | null {
  const [copy, setCopy] = useState<{ file: File; url: string } | null>(null);
  const wanted = !!file && looksLikeMp3(file) && duration > 0 && duration <= SEEKABLE_COPY_MAX_SEC;

  useEffect(() => {
    if (!file || !wanted) return;
    let stale = false;
    let made: string | null = null;
    (async () => {
      if (!isVbrMp3(new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer()))) return;
      const wav = audioBufferToWav(await decodeAudioFile(file));
      if (stale) return;
      made = URL.createObjectURL(wav);
      setCopy({ file, url: made });
    })().catch(() => {});
    return () => {
      stale = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [file, wanted]);

  return wanted && copy?.file === file ? copy : null;
}
