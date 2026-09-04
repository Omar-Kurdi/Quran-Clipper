'use client';

import { useCallback, useRef, useState } from 'react';
import type { VideoCanvasRef } from '@/components/VideoCanvas';
import type { ExportHealth } from '@/lib/exportHealth';

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
  const [isModalOpen, setIsModalOpen] = useState(false);

  const start = useCallback(
    (
      audio: HTMLAudioElement | null,
      range: ExportRange,
      targetFps: number,
      onComplete: (blob: Blob, renderMs: number, health: ExportHealth) => void
    ) => {
      if (!canvasRef.current || !audio) return;

      setIsExporting(true);
      setProgress(0);

      canvasRef.current.exportVideo(
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
    },
    []
  );

  return {
    canvasRef,
    isExporting,
    progress,
    speed,
    isModalOpen,
    setIsModalOpen,
    start,
  };
}
