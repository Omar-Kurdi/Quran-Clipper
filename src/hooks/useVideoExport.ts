'use client';

import { useCallback, useRef, useState } from 'react';
import type { VideoCanvasRef } from '@/components/VideoCanvas';
import type { ExportHealth } from '@/lib/exportHealth';
import { decodeAudioFile } from '@/lib/audioTrim';
import type { ExportPlan } from '@/lib/exportPresets';

export interface ExportRange {
  start: number;
  end: number;
}

/**
 * Rendering the canvas to a file, and recording that it happened.
 *
 * The render itself belongs to `VideoCanvas` -- this owns the progress a
 * caller has to show while it runs, and keeps `canvasRef` next to the state it
 * drives rather than in a scope with sixty other values.
 */
export function useVideoExport() {
  const canvasRef = useRef<VideoCanvasRef | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState('1.0x');
  /** Which container the finished file is in, so it can be named honestly. */
  const [container, setContainer] = useState<'webm' | 'mp4'>('webm');
  const [isModalOpen, setIsModalOpen] = useState(false);


  /** The real-time recorder: every project can take this path. */
  const runRealtime = useCallback((
    audio: HTMLAudioElement,
    range: ExportRange,
    targetFps: number,
    onComplete: (blob: Blob, renderMs: number, health: ExportHealth) => void
  ) => {
      canvasRef.current!.exportVideo(
        audio,
        range,
        (value, rate) => {
          setProgress(value);
          setSpeed(rate);
        },
        (blob, renderMs, health) => {
          setIsExporting(false);
          onComplete(blob, renderMs, health);
        },
        targetFps
      );
  }, []);

  /**
   * Renders the clip, taking the frame-by-frame path when the project allows
   * it and the real-time recorder otherwise.
   *
   * The choice is made here rather than shown to the user, because the thing
   * that decides it -- whether the browser can encode at all -- is not a
   * choice they made about exporting. What differs is speed, container, and
   * resolution: the recorder captures the on-screen canvas, so it can only
   * ever produce the preview's own 1080-class frame. The modal says so before
   * a resolution above that is chosen.
   */
  const start = useCallback(
    (
      audio: HTMLAudioElement | null,
      range: ExportRange,
      plan: ExportPlan,
      onComplete: (blob: Blob, renderMs: number, health: ExportHealth) => void
    ) => {
      if (!canvasRef.current || !audio) return;

      const targetFps = plan.fps;
      setIsExporting(true);
      setProgress(0);

      if (canvasRef.current.canExportOffline()) {
        void (async () => {
          try {
            const source = audio.currentSrc || audio.src;
            const decoded = await decodeAudioFile(await (await fetch(source)).blob());
            const result = await canvasRef.current!.exportVideoOffline(
              range,
              decoded,
              targetFps,
              fraction => {
                setProgress(Math.min(99, Math.round(fraction * 100)));
                setSpeed('…');
              },
              { width: plan.width, height: plan.height, bitrate: plan.bitrate }
            );
            if (result) {
              setIsExporting(false);
              setContainer('mp4');
              setSpeed(`${result.speed.toFixed(1)}x`);
              // No health to report: nothing was captured in real time, so
              // there is no frame to have been starved of.
              onComplete(result.blob, result.elapsedMs, {
                recordedSeconds: range.end - range.start,
                starvedSeconds: 0,
                effectiveFps: targetFps,
                wasHidden: false,
                pauses: 0,
              });
              return;
            }
          } catch (err) {
            if ((err as Error)?.name === 'AbortError') {
              // Cancelled on purpose. Falling back here would start a second
              // export the moment someone asked for none at all.
              setIsExporting(false);
              return;
            }
            // Anything else -- an unreadable source, a refused encoder --
            // falls back rather than failing the export. The recorder path
            // works for every project this one can handle.
            console.warn('[export] frame-by-frame encoding unavailable, recording in real time instead:', err);
          }
          setContainer('webm');
          runRealtime(audio, range, targetFps, onComplete);
        })();
        return;
      }

      setContainer('webm');
      runRealtime(audio, range, targetFps, onComplete);
    },
    [runRealtime]
  );

  /**
   * Stops a render in progress and throws away what it produced.
   *
   * Both paths watch the same flag: the recorder stops and drops its chunks,
   * and the frame loop breaks and closes its encoders rather than spending
   * time flushing an encode nobody is waiting for.
   */
  const cancel = useCallback(() => {
    canvasRef.current?.stopExport();
    setIsExporting(false);
    setProgress(0);
  }, []);

  /**
   * Whether this project will take the frame-by-frame path, for the UI to say
   * so before anyone commits ten minutes to a render. Recomputed on each call
   * rather than cached: the answer changes the moment a background does.
   */
  const willEncodeOffline = useCallback(() => canvasRef.current?.canExportOffline() ?? false, []);

  return {
    canvasRef,
    cancel,
    willEncodeOffline,
    isExporting,
    progress,
    speed,
    container,
    isModalOpen,
    setIsModalOpen,
    start,
  };
}
