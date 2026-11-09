'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrimResult } from '@/lib/audioTrim';
import { isLongAudio } from '@/lib/longAudio';
import { loadMediaDuration } from '@/lib/mediaDuration';
import { volumePreference } from './useVolume';

export interface LongAudio {
  /** The recording as the server keeps it (`editSources`). */
  id: string;
  /** Its length as ffmpeg read it: the clock the envelope and the cut are on. */
  duration: number;
  envelope: Uint8Array;
}

/** Why a long recording could not be read: the server would not, or could not. */
export type LongAudioFailure = 'tooLongHere' | 'decodeFailed';

async function postLong(form: FormData): Promise<Response> {
  return fetch('/api/audio/long', { method: 'POST', body: form });
}

async function readLong(file: File): Promise<LongAudio> {
  const form = new FormData();
  form.append('op', 'read');
  form.append('source', file);
  const res = await postLong(form);
  if (!res.ok) throw Object.assign(new Error('read failed'), { status: res.status });
  const body = await res.json();
  const envelope = Uint8Array.from(atob(String(body.envelope)), char => char.charCodeAt(0));
  return { id: String(body.id), duration: Number(body.duration), envelope };
}

/** Whether `file` is too long for the browser to decode whole (`isLongAudio`). */
export async function isLongFile(file: File): Promise<boolean> {
  const url = URL.createObjectURL(file);
  try {
    return isLongAudio(await loadMediaDuration(url));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** [start, end] of a long recording, cut by the server; sends the file again if the server has let it go. */
export async function cutLong(file: File, long: Pick<LongAudio, 'id' | 'duration'>, start: number, end: number): Promise<TrimResult> {
  const send = (withFile: boolean) => {
    const form = new FormData();
    form.append('op', 'cut');
    if (withFile) form.append('source', file);
    else form.append('sourceId', long.id);
    form.append('start', String(start));
    form.append('end', String(end));
    form.append('duration', String(long.duration));
    return postLong(form);
  };
  let res = await send(false);
  if (res.status === 404) res = await send(true);
  if (!res.ok) throw new Error('cut failed');
  const baseName = file.name.replace(/\.[^./]+$/, '') || 'audio';
  const cut = new File([await res.blob()], `${baseName}-trimmed.mp3`, { type: 'audio/mpeg' });
  return { file: cut, url: URL.createObjectURL(cut), duration: end - start };
}

/**
 * The trim dialog's long-recording path (`longAudio.ts`): whether `file` is
 * too long for the browser to decode, and if so its envelope from the server
 * and a player that streams it rather than holding it.
 *
 * Played by an `<audio>` element on the copy the server made to listen to,
 * not on the file itself: the browser seeks an MP3 by estimate, and that copy
 * is on ffmpeg's clock, as the envelope and the cut are (`readEnvelope`).
 */
export function useLongAudio(
  file: File,
  handlers: { onRead: (long: LongAudio) => void; onFailed: (failure: LongAudioFailure) => void }
) {
  const [mode, setMode] = useState<'checking' | 'short' | 'long'>('checking');
  const [long, setLong] = useState<LongAudio | null>(null);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    let cancelled = false;
    const url = URL.createObjectURL(file);
    loadMediaDuration(url).then(seconds => {
      if (cancelled) return;
      if (!isLongAudio(seconds)) return setMode('short');
      setMode('long');
      readLong(file)
        .then(read => {
          if (cancelled) return;
          setLong(read);
          handlersRef.current.onRead(read);
        })
        .catch((err: { status?: number }) => {
          if (!cancelled) handlersRef.current.onFailed(err.status === 403 ? 'tooLongHere' : 'decodeFailed');
        });
    });
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  return { mode, long, ...useLongPlayer(long?.id) };
}

/** Plays the server's copy to listen to of the recording kept as `id`, streamed rather than held. */
function useLongPlayer(id: string | undefined) {
  const elementRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => {
    elementRef.current?.pause();
    elementRef.current = null;
  }, [id]);

  const element = useCallback(() => {
    if (!elementRef.current) elementRef.current = new Audio(`/api/audio/long?id=${id}`);
    return elementRef.current;
  }, [id]);

  /** Plays from `seconds` at `rate`, keeping the pitch; `onEnded` when the recording runs out. */
  const play = useCallback((seconds: number, rate: number, onEnded: () => void) => {
    const audio = element();
    audio.volume = volumePreference.get();
    audio.playbackRate = rate;
    audio.currentTime = seconds;
    audio.onended = onEnded;
    audio.play().catch(() => undefined);
  }, [element]);

  const stop = useCallback(() => {
    const audio = elementRef.current;
    if (!audio) return;
    audio.onended = null;
    audio.pause();
  }, []);

  const setRate = useCallback((rate: number) => {
    if (elementRef.current) elementRef.current.playbackRate = rate;
  }, []);
  const position = useCallback(() => elementRef.current?.currentTime ?? 0, []);
  const setVolume = useCallback((volume: number) => {
    if (elementRef.current) elementRef.current.volume = volume;
  }, []);

  return { play, stop, position, setVolume, setRate };
}
