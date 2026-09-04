'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
export function useAudioPlayback() {
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(43.0);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.9);
  const [error, setError] = useState<string | null>(null);

  /**
   * A seek waiting for the media it belongs to.
   *
   * Set when a new recording is loaded with a position to jump to; applied only
   * once the browser has actually selected that resource, so it cannot land on
   * the recording that was playing a moment ago.
   */
  const pendingSeekRef = useRef<{ url: string; time: number } | null>(null);

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

  const onTimeUpdate = useCallback(() => {
    if (elementRef.current) setCurrentTime(elementRef.current.currentTime);
  }, []);

  const onLoadedMetadata = useCallback(() => {
    const audio = elementRef.current;
    if (!audio) return;
    setDuration(audio.duration || 43.0);
    setError(null);
    applyPendingSeek();
  }, [applyPendingSeek]);

  return {
    elementRef,
    analyserNode,
    isPlaying, setIsPlaying,
    currentTime, setCurrentTime,
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
  };
}
