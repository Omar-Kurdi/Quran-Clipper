'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useVolume, volumePreference } from './useVolume';

/**
 * The studio's audio transport: the element, the clock, and the Web Audio graph
 * the visualiser reads from.
 *
 * Pulled out of the page because none of it is about the *timeline*. The page
 * had grown to hold every piece of studio state in one scope, which is how a
 * field ended up feeding two places that each added their own range to it. This
 * is the part with the clearest edge: nothing here needs to know what a verse
 * is.
 */
/** Reloads of one recording before its error is shown. */
const MAX_RETRIES = 3;
/** The wait before the first reload; each later one waits this much longer. */
const RETRY_DELAY_MS = 800;

export function useAudioPlayback() {
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(43.0);
  const [isMuted, setIsMuted] = useState(false);
  /**
   * Read from the shared preference rather than held here, so the trim dialog
   * and the export preview play at the same loudness as the timeline and a
   * reload comes back where it was left.
   */
  const volume = useVolume();
  const setVolume = useCallback((next: number) => volumePreference.set(next), []);
  const [error, setError] = useState<string | null>(null);

  /**
   * A seek waiting for the media it belongs to.
   *
   * Set when a new recording is loaded with a position to jump to; applied only
   * once the browser has actually selected that resource, so it cannot land on
   * the recording that was playing a moment ago.
   */
  const pendingSeekRef = useRef<{ url: string; time: number } | null>(null);

  /** Reloads tried for the recording now selected; a new recording starts again from none. */
  const retriesRef = useRef<{ src: string; count: number }>({ src: '', count: 0 });

  const togglePlayPause = useCallback(() => {
    const audio = elementRef.current;
    if (!audio) return;

    if (!contextRef.current) {
      try {
        const ctx = new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        const source = ctx.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(ctx.destination);

        contextRef.current = ctx;
        analyserRef.current = analyser;
        setAnalyserNode(analyser);
      } catch {
        // Already connected, or Web Audio is unavailable -- playback still works.
      }
    }

    if (contextRef.current?.state === 'suspended') {
      contextRef.current.resume();
    }

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }, [isPlaying]);

  const seek = useCallback((seconds: number) => {
    if (!elementRef.current) return;
    elementRef.current.currentTime = seconds;
    setCurrentTime(seconds);
  }, []);

  /** Point the element at a new recording, optionally jumping into it. */
  const load = useCallback((url: string, atTime?: number) => {
    if (typeof atTime === 'number') pendingSeekRef.current = { url, time: atTime };
    const audio = elementRef.current;
    if (!audio) return;
    audio.src = url;
    if (typeof atTime !== 'number') audio.currentTime = 0;
    audio.load();
  }, []);

  /** Queue a jump for a recording the element is about to be pointed at. */
  const queueSeek = useCallback((url: string, time: number) => {
    pendingSeekRef.current = { url, time };
  }, []);

  const applyPendingSeek = useCallback(() => {
    const audio = elementRef.current;
    const pending = pendingSeekRef.current;
    if (!audio || !pending) return;
    // `currentSrc` rather than `src`: React commits the new `src` attribute
    // before effects run, so there is a window where `src` already names the
    // new recording while `duration` still describes the old one. `currentSrc`
    // is only set once the browser has actually selected that resource, so
    // waiting for it means the seek lands on the media it was meant for.
    if (audio.currentSrc !== new URL(pending.url, window.location.href).href) return;
    if (audio.readyState < 1 || !Number.isFinite(audio.duration)) return;
    pendingSeekRef.current = null;
    if (pending.time <= 0 || pending.time >= audio.duration) return;
    audio.currentTime = pending.time;
    setCurrentTime(pending.time);
  }, []);

  /**
   * The element's position right now. `currentTime` follows `timeupdate`,
   * which fires only a few times a second; whatever animates with playback
   * reads this once per frame instead.
   */
  const playhead = useCallback(() => elementRef.current?.currentTime ?? 0, []);

  const onTimeUpdate = useCallback(() => {
    if (elementRef.current) setCurrentTime(elementRef.current.currentTime);
  }, []);

  /**
   * Try the recording again after a failed load or a dropped stream, from where
   * it was and playing if it was. True while a retry is under way, so the
   * caller holds its error back.
   *
   * One failure used to be final: a reciter's file the audio server was slow to
   * hand over, or a connection dropped mid-recitation, left an error on screen
   * -- over a recording that, as often as not, then played on from its buffer
   * (the Arabic captions demo was filmed like that).
   */
  const recover = useCallback(() => {
    const audio = elementRef.current;
    const src = audio?.currentSrc;
    if (!audio || !src) return false;
    const tries = retriesRef.current.src === src ? retriesRef.current.count : 0;
    if (tries >= MAX_RETRIES) return false;
    retriesRef.current = { src, count: tries + 1 };
    const at = audio.currentTime;
    const wasPlaying = !audio.paused;
    if (at > 0) pendingSeekRef.current = { url: src, time: at };
    window.setTimeout(() => {
      if (audio.currentSrc !== src && audio.src !== src) return;
      audio.load();
      if (wasPlaying) audio.play().catch(() => {});
    }, RETRY_DELAY_MS * (tries + 1));
    return true;
  }, []);

  /** The recording is playable again: whatever went wrong before no longer stands. */
  const onCanPlay = useCallback(() => setError(null), []);

  const onLoadedMetadata = useCallback(() => {
    const audio = elementRef.current;
    if (!audio) return;
    setDuration(audio.duration || 43.0);
    setError(null);
    applyPendingSeek();
  }, [applyPendingSeek]);

  /**
   * Keep the element at the volume that is actually set.
   *
   * This used to be applied only inside the slider's own handler, so a stored
   * preference -- or the default -- did nothing until the slider was touched:
   * every reload started at whatever the element's own default was, which is
   * full. Syncing here covers the load, a change from another tab, and a
   * recording being swapped underneath.
   */
  /**
   * A load that failed before the page was interactive reached no handler: the
   * element arrives from the server with its `src` and starts loading at once,
   * and a refused request came back in a few hundred milliseconds -- leaving no
   * audio, no retry and no message. Handed to the element's own error handler
   * once that is attached.
   */
  useEffect(() => {
    const audio = elementRef.current;
    if (audio?.error) audio.dispatchEvent(new Event('error'));
  }, []);

  useEffect(() => {
    const audio = elementRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = isMuted || volume === 0;
  }, [volume, isMuted]);

  return {
    elementRef,
    analyserNode,
    isPlaying, setIsPlaying,
    currentTime, setCurrentTime,
    playhead,
    duration, setDuration,
    isMuted, setIsMuted,
    volume, setVolume,
    error, setError,
    togglePlayPause,
    seek,
    load,
    queueSeek,
    applyPendingSeek,
    onTimeUpdate,
    onLoadedMetadata,
    onCanPlay,
    recover,
  };
}
