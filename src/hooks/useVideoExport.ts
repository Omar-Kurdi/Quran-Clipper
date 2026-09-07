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
  /**
   * The frame the last render actually produced.
   *
   * A ref because it is read in the same tick it is written -- the completion
   * callback saves the record immediately -- and because it is not something
   * anything renders. It matters because the two paths do not produce the same
   * frame: the encoder renders the plan, while the recorder can only capture
   * the preview canvas, so a render that fell back to it was being filed under
   * a resolution the file did not have.
   */
  const lastOutput = useRef<{ width: number; height: number } | null>(null);
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
              lastOutput.current = { width: plan.width, height: plan.height };
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
          lastOutput.current = canvasRef.current?.captureSize() ?? null;
          runRealtime(audio, range, targetFps, onComplete);
        })();
        return;
      }

      setContainer('webm');
      lastOutput.current = canvasRef.current?.captureSize() ?? null;
      runRealtime(audio, range, targetFps, onComplete);
    },
    [runRealtime]
  );

  const [previewing, setPreviewing] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);

  /**
   * A small, quick render of the whole clip, for looking at before committing.
   *
   * Its own path rather than a call through `start`, on purpose: this is not an
   * export and must not be recorded as one. It does not touch `container`, it
   * does not set `lastOutput`, and nothing above it saves a row for it -- a
   * render log that fills with 360-pixel previews stops being a record of what
   * was made.
   *
   * Frame by frame only. The alternative path records in real time, so a
   * "quick preview" there would take exactly as long as watching the clip,
   * which is the thing it is supposed to save. Callers that cannot encode
   * offline should not offer this at all.
   *
   * `null` means it did not produce anything -- cancelled, or the encoder
   * refused -- and the caller should say nothing rather than show an empty
   * player.
   */
  const renderPreview = useCallback(
    async (
      audio: HTMLAudioElement | null,
      range: ExportRange,
      output: { width: number; height: number; fps: number; bitrate: number }
    ): Promise<Blob | null> => {
      if (!canvasRef.current || !audio || !canvasRef.current.canExportOffline()) return null;
      setPreviewing(true);
      setPreviewProgress(0);
      try {
        const source = audio.currentSrc || audio.src;
        const decoded = await decodeAudioFile(await (await fetch(source)).blob());
        const result = await canvasRef.current.exportVideoOffline(
          range,
          decoded,
          output.fps,
          fraction => setPreviewProgress(Math.min(99, Math.round(fraction * 100))),
          { width: output.width, height: output.height, bitrate: output.bitrate }
        );
        return result?.blob ?? null;
      } catch {
        // Cancelled, or an encoder that refused this size. Either way there is
        // nothing to show, and a preview is not worth an error of its own.
        return null;
      } finally {
        setPreviewing(false);
        setPreviewProgress(0);
      }
    },
    []
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
    lastOutput,
    renderPreview,
    previewing,
    previewProgress,
    isExporting,
    progress,
    speed,
    container,
    isModalOpen,
    setIsModalOpen,
    start,
  };
}
