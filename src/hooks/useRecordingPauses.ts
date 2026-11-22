'use client';

import { useEffect, useMemo, useState } from 'react';
import { decodeAudioFile } from '@/lib/audioTrim';
import { isLongAudio } from '@/lib/longAudio';
import { envelopeOf, findPauses, type Pause } from '@/lib/pauses';

/**
 * The pauses in the uploaded recording (`pauses.ts`): a long one's from the
 * envelope the server read of it, a shorter one's from the browser's own
 * decode, made once per file. Empty until known, and for anything else.
 */
export function useRecordingPauses(
  file: File | null, duration: number, long: { envelope: Uint8Array } | null
): Pause[] {
  const fromServer = useMemo(() => (long ? findPauses(long.envelope) : null), [long]);
  const [decoded, setDecoded] = useState<{ file: File; pauses: Pause[] } | null>(null);
  const wanted = !!file && duration > 0 && !isLongAudio(duration);
  useEffect(() => {
    if (!file || !wanted) return;
    let stale = false;
    decodeAudioFile(file)
      .then(buffer => {
        if (!stale) setDecoded({ file, pauses: findPauses(envelopeOf(buffer.getChannelData(0), buffer.sampleRate)) });
      })
      .catch(() => { /* no pauses is all an undecodable file costs: stretches are let go where dragged */ });
    return () => { stale = true; };
  }, [file, wanted]);
  if (fromServer) return fromServer;
  return wanted && decoded?.file === file ? decoded.pauses : NONE;
}

const NONE: Pause[] = [];
