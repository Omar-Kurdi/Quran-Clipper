'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { audioBufferToWav, decodeAudioFile } from '@/lib/audioTrim';
import { isLongAudio } from '@/lib/longAudio';
import { isVbrMp3, looksLikeMp3, SEEKABLE_COPY_MAX_SEC } from '@/lib/seekableAudio';
import { provideLongWaveform } from '@/lib/waveform';
import { readLong, type LongAudio } from './useLongAudio';

/** The start of a file: room for a large ID3 tag, cover art and all, and the first frame after it. */
const HEAD_BYTES = 1 << 20;

/** The copy of a short VBR MP3 to play: a WAV of the same decode, which seeks exactly (`seekableAudio.ts`). */
async function wavCopy(file: File): Promise<Blob | null> {
  if (!isVbrMp3(new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer()))) return null;
  return audioBufferToWav(await decodeAudioFile(file));
}

/** A short upload's copy to play, once made; null for any upload that needs none. */
function useWavCopy(file: File | null, wanted: boolean) {
  const [copy, setCopy] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!file || !wanted) return;
    let stale = false;
    let made: string | null = null;
    wavCopy(file).then(wav => {
      if (stale || !wav) return;
      made = URL.createObjectURL(wav);
      setCopy({ file, url: made });
    }).catch(() => {});
    return () => {
      stale = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [file, wanted]);
  return wanted && copy?.file === file ? copy.url : null;
}

/** What the page is told of a long upload's read: that it has begun -- it takes a while -- and how it ended, or that it was let go unfinished. */
export interface ReadEvents {
  started: () => void;
  finished: (long: LongAudio | null) => void;
  /** Another recording opened first: whatever `started` said is no longer so. */
  abandoned: () => void;
}

/** Where the server's copy of a long upload plays from: a fresh address after each read, so the element loads it anew. */
const listenUrl = (id: string, attempt: number) => `/api/audio/long?id=${id}${attempt ? `&r=${attempt}` : ''}`;

/**
 * A long upload as the server reads it (`/api/audio/long`): kept there, its
 * waveform drawn from the envelope of that read, and played from the Ogg copy
 * it makes, which seeks exactly where the browser's own MP3 player does not.
 * `refresh` reads it again, for when that copy has been let go.
 */
function useServerRead(file: File | null, url: string | null, wanted: boolean, events: ReadEvents) {
  const [read, setRead] = useState<{ file: File; long: LongAudio | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const eventsRef = useRef(events);
  useEffect(() => {
    eventsRef.current = events;
  });
  useEffect(() => {
    if (!file || !url || !wanted) return;
    let stale = false;
    let settled = false;
    eventsRef.current.started();
    readLong(file)
      .then(long => {
        if (stale) return;
        settled = true;
        // Under both addresses the timeline may ask for it by: the file's, and the copy's it then plays.
        provideLongWaveform(url, long);
        provideLongWaveform(listenUrl(long.id, attempt), long);
        setRead({ file, long });
        eventsRef.current.finished(long);
      })
      .catch(() => {
        if (stale) return;
        settled = true;
        // Said either way, or the timeline waits for a waveform that will not come.
        provideLongWaveform(url, null);
        setRead({ file, long: null });
        eventsRef.current.finished(null);
      });
    return () => {
      stale = true;
      if (!settled) eventsRef.current.abandoned();
    };
  }, [file, url, wanted, attempt]);
  const refresh = useCallback(() => setAttempt(n => n + 1), []);
  const current = wanted && read?.file === file ? read : null;
  return { long: current?.long ?? null, attempt, reading: wanted && !current, failed: !!current && !current.long, refresh };
}

/**
 * How an upload plays, when not from the file itself: the copy that seeks
 * exactly -- a WAV of a short VBR MP3, or the server's copy of a recording
 * too long for the browser to hold -- once it is ready, else null.
 *
 * Only the `<audio>` element plays the copy. The upload is still what is
 * stored and sent to the aligner, and exports cut what they render from it.
 * A public studio keeps no visitor's recording, so there (`server` false) a
 * long upload plays from the file, its waveform left out.
 */
export function usePlayableUpload(file: File | null, fileUrl: string | null, duration: number, server: boolean, events: ReadEvents) {
  const long = !!file && isLongAudio(duration);
  const wavUrl = useWavCopy(file, !!file && !long && looksLikeMp3(file) && duration > 0 && duration <= SEEKABLE_COPY_MAX_SEC);
  const read = useServerRead(file, fileUrl, long && server, events);
  // Nothing to wait for on a public studio: the timeline is told there is no waveform.
  useEffect(() => {
    if (long && !server && fileUrl) provideLongWaveform(fileUrl, null);
  }, [long, server, fileUrl]);
  return {
    // A fresh address after a read again, so the element loads the new copy rather than its failure.
    url: read.long ? listenUrl(read.long.id, read.attempt) : wavUrl,
    /** The server's read of a long upload: its id there and its length on ffmpeg's clock. */
    long: read.long,
    isLong: long,
    reading: read.reading,
    refresh: read.refresh,
  };
}
