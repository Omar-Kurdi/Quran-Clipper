'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Scissors, X, Loader2, Play, Pause, RotateCcw } from 'lucide-react';
import { decodeAudioFile, computePeaks, buildTrimmedFile, TrimResult } from '@/lib/audioTrim';

interface AudioTrimModalProps {
  isOpen: boolean;
  file: File;
  audioUrl: string;
  onCancel: () => void;
  onApply: (result: TrimResult & { trimStart: number; trimEnd: number }) => void;
}

/** `M:SS.s`, matching the format used for durations elsewhere in the studio. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, seconds);
  const mins = Math.floor(s / 60);
  const secs = (s % 60).toFixed(1).padStart(4, '0');
  return `${mins}:${secs}`;
}

const WAVEFORM_BUCKETS = 400;
const MIN_TRIM_SECONDS = 0.3;

export const AudioTrimModal: React.FC<AudioTrimModalProps> = ({ isOpen, file, audioUrl, onCancel, onApply }) => {
  const bufferRef = useRef<AudioBuffer | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  const [isDecoding, setIsDecoding] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // Decode once per mount. The parent remounts this component (via `key`)
  // whenever `file` changes, so a fresh `isDecoding`/`peaks`/etc. starts from
  // their `useState` defaults automatically -- no synchronous reset needed
  // here, which would otherwise show a stale waveform for an instant when
  // reopening with a different file. Runs even while closed (`isOpen` false)
  // so the waveform is already there the moment the user opens the modal.
  useEffect(() => {
    let cancelled = false;
    decodeAudioFile(file)
      .then(buffer => {
        if (cancelled) return;
        bufferRef.current = buffer;
        setPeaks(computePeaks(buffer, WAVEFORM_BUCKETS));
        setDuration(buffer.duration);
        setTrimStart(0);
        setTrimEnd(buffer.duration);
        setIsDecoding(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Could not read this audio file for trimming. Try a different file, or continue without trimming.');
        setIsDecoding(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const xToTime = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration]
  );

  // Drag handles via window-level listeners, so the pointer can leave the
  // track without losing the drag -- a plain onMouseMove on the handle itself
  // stops firing the moment the cursor outruns a 6px-wide element.
  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: PointerEvent) => {
      const t = xToTime(e.clientX);
      if (dragging === 'start') {
        setTrimStart(Math.min(t, trimEnd - MIN_TRIM_SECONDS));
      } else {
        setTrimEnd(Math.max(t, trimStart + MIN_TRIM_SECONDS));
      }
    };
    const handleUp = () => setDragging(null);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [dragging, xToTime, trimStart, trimEnd]);

  // Stop the preview at the trimmed-out end rather than playing past it.
  useEffect(() => {
    const audio = previewRef.current;
    if (!audio || !isPreviewing) return;
    const check = () => {
      if (audio.currentTime >= trimEnd) {
        audio.pause();
        setIsPreviewing(false);
      }
    };
    audio.addEventListener('timeupdate', check);
    return () => audio.removeEventListener('timeupdate', check);
  }, [isPreviewing, trimEnd]);

  if (!isOpen) return null;

  const togglePreview = () => {
    const audio = previewRef.current;
    if (!audio) return;
    if (isPreviewing) {
      audio.pause();
      setIsPreviewing(false);
    } else {
      audio.currentTime = trimStart;
      audio.play().then(() => setIsPreviewing(true)).catch(() => {});
    }
  };

  const handleReset = () => {
    setTrimStart(0);
    setTrimEnd(duration);
  };

  const handleApply = () => {
    const buffer = bufferRef.current;
    if (!buffer) return;
    setIsApplying(true);
    try {
      const result = buildTrimmedFile(buffer, trimStart, trimEnd, file.name);
      onApply({ ...result, trimStart, trimEnd });
    } catch {
      setError('Could not trim this audio file.');
      setIsApplying(false);
    }
  };

  const startPct = duration > 0 ? (trimStart / duration) * 100 : 0;
  const endPct = duration > 0 ? (trimEnd / duration) * 100 : 100;
  const trimmedDuration = Math.max(0, trimEnd - trimStart);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-amber-500 via-emerald-500 to-amber-500"></div>

        <button
          onClick={onCancel}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="p-3 bg-amber-500/20 text-amber-400 rounded-xl border border-amber-500/30">
            <Scissors className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">Trim / Crop Audio</h3>
            <p className="text-xs text-slate-400">Drag the handles to select what to keep, from either end of the file.</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-300 text-xs rounded-lg">{error}</div>
        )}

        {isDecoding ? (
          <div className="h-24 flex items-center justify-center gap-2 text-slate-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Reading audio…</span>
          </div>
        ) : (
          <>
            <div
              ref={trackRef}
              className="relative w-full h-24 bg-slate-950 rounded-lg border border-slate-800 overflow-hidden select-none touch-none"
            >
              <Waveform peaks={peaks} />

              {/* Cut-out shading */}
              <div className="absolute inset-y-0 left-0 bg-slate-950/75" style={{ width: `${startPct}%` }} />
              <div className="absolute inset-y-0 right-0 bg-slate-950/75" style={{ width: `${100 - endPct}%` }} />

              {/* Kept region border */}
              <div
                className="absolute inset-y-0 border-x-2 border-amber-400 pointer-events-none"
                style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
              />

              {/* Handles */}
              <div
                onPointerDown={() => setDragging('start')}
                className="absolute inset-y-0 -ml-2.5 w-5 cursor-ew-resize flex items-center justify-center group"
                style={{ left: `${startPct}%` }}
              >
                <div className="w-1.5 h-12 rounded-full bg-amber-400 group-hover:bg-amber-300 shadow-lg" />
              </div>
              <div
                onPointerDown={() => setDragging('end')}
                className="absolute inset-y-0 -ml-2.5 w-5 cursor-ew-resize flex items-center justify-center group"
                style={{ left: `${endPct}%` }}
              >
                <div className="w-1.5 h-12 rounded-full bg-amber-400 group-hover:bg-amber-300 shadow-lg" />
              </div>
            </div>

            <div className="flex items-center justify-between mt-2 text-[11px] font-mono text-slate-400">
              <span className="text-amber-400">{formatDuration(trimStart)}</span>
              <span>{formatDuration(duration)} total</span>
              <span className="text-amber-400">{formatDuration(trimEnd)}</span>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-4">
              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-1">Start (s)</label>
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, trimEnd - MIN_TRIM_SECONDS)}
                  step={0.1}
                  value={Math.round(trimStart * 10) / 10}
                  onChange={e => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setTrimStart(Math.max(0, Math.min(v, trimEnd - MIN_TRIM_SECONDS)));
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-1">End (s)</label>
                <input
                  type="number"
                  min={Math.min(duration, trimStart + MIN_TRIM_SECONDS)}
                  max={duration}
                  step={0.1}
                  value={Math.round(trimEnd * 10) / 10}
                  onChange={e => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setTrimEnd(Math.min(duration, Math.max(v, trimStart + MIN_TRIM_SECONDS)));
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-1">Selected length</label>
                <div className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-emerald-400 font-mono">
                  {formatDuration(trimmedDuration)}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={togglePreview}
                className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-700 transition-colors flex items-center gap-1.5"
              >
                {isPreviewing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>{isPreviewing ? 'Stop preview' : 'Preview selection'}</span>
              </button>
              <button
                onClick={handleReset}
                className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-700 transition-colors flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            </div>

            <audio ref={previewRef} src={audioUrl} className="hidden" />
          </>
        )}

        <div className="flex gap-2 mt-6">
          <button
            onClick={onCancel}
            disabled={isApplying}
            className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg border border-slate-700 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={isDecoding || isApplying || trimmedDuration < MIN_TRIM_SECONDS}
            className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5"
          >
            {isApplying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
            <span>{isApplying ? 'Trimming…' : 'Apply Trim'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

/** Static peak-bar waveform. Drawn once per `peaks` change -- it never needs to animate. */
const Waveform: React.FC<{ peaks: Float32Array | null }> = ({ peaks }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fbbf24';
    const barWidth = width / peaks.length;
    const mid = height / 2;
    for (let i = 0; i < peaks.length; i++) {
      const barHeight = Math.max(1, peaks[i] * mid);
      ctx.fillRect(i * barWidth, mid - barHeight, Math.max(1, barWidth - 1), barHeight * 2);
    }
  }, [peaks]);

  return <canvas ref={canvasRef} width={800} height={96} className="w-full h-full opacity-70" />;
};
