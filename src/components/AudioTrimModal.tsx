'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Scissors, X, Loader2, Play, Pause, RotateCcw, ZoomIn, ZoomOut, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { decodeAudioFile, computePeaks, buildTrimmedFile, TrimResult } from '@/lib/audioTrim';
import { Dialog } from './Dialog';

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

/**
 * Parses the timecodes the trim inputs accept: `3:31.7`, `3:31`, `1:02:05.4`,
 * or a bare `211.7`. Returns null for anything unparseable -- including the
 * empty field and a half-typed `3:` -- so the caller reverts to the previous
 * value instead of committing a NaN.
 */
export function parseTimecode(input: string): number | null {
  const parts = input.trim().split(':');
  if (parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(part)) return null;
    total = total * 60 + Number(part);
  }
  return Number.isFinite(total) ? total : null;
}

/** Ruler tick label. Drops the decimal once the ticks are a second or more apart. */
function formatTick(seconds: number, step: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return step < 1
    ? `${mins}:${secs.toFixed(1).padStart(4, '0')}`
    : `${mins}:${Math.round(secs).toString().padStart(2, '0')}`;
}

const WAVEFORM_BUCKETS = 400;
/** Keeps the canvas under the browser's max dimension (bucketCount * 2 px wide). */
const MAX_WAVEFORM_BUCKETS = 6000;
const MIN_TRIM_SECONDS = 0.3;
const ZOOM_LEVELS = [1, 2, 4, 8, 16];
/** Ruler intervals in seconds -- the smallest one that keeps labels from colliding wins. */
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const TICKS_PER_SCREEN = 6;

type DragTarget = 'start' | 'end' | 'playhead';

export const AudioTrimModal: React.FC<AudioTrimModalProps> = ({ isOpen, file, audioUrl, onCancel, onApply }) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  const [isDecoding, setIsDecoding] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [dragging, setDragging] = useState<DragTarget | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [startDraft, setStartDraft] = useState<string | null>(null);
  const [endDraft, setEndDraft] = useState<string | null>(null);

  // Read by the rAF loop, which must not be torn down and rebuilt every time
  // one of these changes -- `trimEnd` changes on every frame of a handle drag.
  const trimEndRef = useRef(0);
  const draggingRef = useRef<DragTarget | null>(null);
  const stopAtSelectionEndRef = useRef(false);
  const zoomAnchorRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    trimEndRef.current = trimEnd;
    draggingRef.current = dragging;
  }, [trimEnd, dragging]);

  // Decode once per mount. The parent remounts this component (via `key`)
  // whenever `file` changes, so a fresh `isDecoding`/`buffer`/etc. starts from
  // their `useState` defaults automatically -- no synchronous reset needed
  // here, which would otherwise show a stale waveform for an instant when
  // reopening with a different file. Runs even while closed (`isOpen` false)
  // so the waveform is already there the moment the user opens the modal.
  useEffect(() => {
    let cancelled = false;
    decodeAudioFile(file)
      .then(decoded => {
        if (cancelled) return;
        setBuffer(decoded);
        setDuration(decoded.duration);
        setTrimStart(0);
        setTrimEnd(decoded.duration);
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

  // Zooming in re-buckets the peaks so the extra width shows real detail
  // rather than the same 400 bars stretched wider. Memoised because the
  // playhead re-renders this component every animation frame while playing.
  const bucketCount = Math.min(MAX_WAVEFORM_BUCKETS, Math.round(WAVEFORM_BUCKETS * zoom));
  const peaks = useMemo(() => (buffer ? computePeaks(buffer, bucketCount) : null), [buffer, bucketCount]);

  const xToTime = useCallback(
    (clientX: number) => {
      // Measured against the inner (zoomed-width) track, not the viewport, so
      // the mapping stays correct when the track is scrolled.
      const el = trackRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration]
  );

  const scrollToTime = useCallback((seconds: number, mode: 'center' | 'ensure') => {
    const vp = viewportRef.current;
    if (!vp || duration <= 0) return;
    const x = (seconds / duration) * vp.scrollWidth;
    if (mode === 'ensure') {
      const margin = vp.clientWidth * 0.15;
      if (x >= vp.scrollLeft + margin && x <= vp.scrollLeft + vp.clientWidth - margin) return;
    }
    vp.scrollLeft = Math.max(0, Math.min(x - vp.clientWidth / 2, vp.scrollWidth - vp.clientWidth));
  }, [duration]);

  const seek = useCallback(
    (seconds: number) => {
      const clamped = Math.max(0, Math.min(seconds, duration));
      setPlayhead(clamped);
      const audio = previewRef.current;
      if (audio) audio.currentTime = clamped;
    },
    [duration]
  );

  // Drag handles and the playhead via window-level listeners, so the pointer
  // can leave the track without losing the drag -- a plain onPointerMove on
  // the handle itself stops firing the moment the cursor outruns a 6px-wide
  // element.
  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: PointerEvent) => {
      const t = xToTime(e.clientX);
      if (dragging === 'start') {
        setTrimStart(Math.min(t, trimEnd - MIN_TRIM_SECONDS));
      } else if (dragging === 'end') {
        setTrimEnd(Math.max(t, trimStart + MIN_TRIM_SECONDS));
      } else {
        stopAtSelectionEndRef.current = false;
        seek(t);
      }
    };
    const handleUp = () => setDragging(null);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [dragging, xToTime, seek, trimStart, trimEnd]);

  // Moves the indicator to wherever playback actually is, and cuts the preview
  // off at the end of the selection. Everything this reads that changes
  // mid-playback is behind a ref, so the rAF loop below survives a handle drag
  // -- `trimEnd` changes on every frame of one -- without being rebuilt.
  const syncPlayhead = useCallback(() => {
    const audio = previewRef.current;
    if (!audio) return;
    const t = audio.currentTime;
    setPlayhead(t);
    if (stopAtSelectionEndRef.current && t >= trimEndRef.current) {
      audio.pause();
    } else if (!draggingRef.current) {
      // Never auto-scroll mid-drag; it would yank the track out from under the
      // pointer just as the user is placing a trim point.
      scrollToTime(t, 'ensure');
    }
  }, [scrollToTime]);

  // requestAnimationFrame gives a playhead that moves smoothly, where the audio
  // element's own `timeupdate` fires ~4x a second and visibly stutters. But rAF
  // is paused entirely while the tab is hidden, so `timeupdate` stays wired up
  // on the element as the coarse fallback -- otherwise a backgrounded preview
  // would sail straight past the end of the selection.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      syncPlayhead();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, syncPlayhead]);

  // Zooming from the centre of what you were already looking at. Without this
  // the viewport snaps back to 0:00 and the zoom is more disorienting than
  // useful. Layout effect so the scroll lands before the browser paints.
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    if (anchor === null) return;
    scrollToTime(anchor, 'center');
  }, [zoom, scrollToTime]);

  const ticks = useMemo(() => {
    if (duration <= 0) return [];
    const visible = duration / zoom;
    const step = TICK_STEPS.find(s => s >= visible / TICKS_PER_SCREEN) ?? TICK_STEPS[TICK_STEPS.length - 1];
    const out: { time: number; label: string }[] = [];
    for (let t = 0; t <= duration + 1e-6; t += step) out.push({ time: t, label: formatTick(t, step) });
    return out;
  }, [duration, zoom]);


  const changeZoom = (next: number) => {
    const vp = viewportRef.current;
    if (vp && duration > 0 && vp.scrollWidth > 0) {
      zoomAnchorRef.current = ((vp.scrollLeft + vp.clientWidth / 2) / vp.scrollWidth) * duration;
    }
    setZoom(next);
  };

  const zoomIndex = ZOOM_LEVELS.indexOf(zoom);

  const togglePlayback = (fromSelection: boolean) => {
    const audio = previewRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      return;
    }
    stopAtSelectionEndRef.current = fromSelection;
    if (fromSelection || playhead >= duration - 0.01) seek(trimStart);
    audio.play().catch(() => {});
  };

  const handleReset = () => {
    setTrimStart(0);
    setTrimEnd(duration);
  };

  const commitStart = (text: string) => {
    setStartDraft(null);
    const parsed = parseTimecode(text);
    if (parsed === null) return;
    setTrimStart(Math.max(0, Math.min(parsed, trimEnd - MIN_TRIM_SECONDS)));
  };

  const commitEnd = (text: string) => {
    setEndDraft(null);
    const parsed = parseTimecode(text);
    if (parsed === null) return;
    setTrimEnd(Math.min(duration, Math.max(parsed, trimStart + MIN_TRIM_SECONDS)));
  };

  const handleApply = () => {
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

  const pct = (seconds: number) => (duration > 0 ? (seconds / duration) * 100 : 0);
  const startPct = pct(trimStart);
  const endPct = duration > 0 ? pct(trimEnd) : 100;
  const playheadPct = pct(playhead);
  const trimmedDuration = Math.max(0, trimEnd - trimStart);
  const timecodeInputClass =
    'w-full bg-slate-950 border border-slate-800 focus:border-amber-500/60 focus:outline-none rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono';

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onCancel}
      label="Trim or crop audio"
      dismissible={!isApplying}
      panelClassName="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl"
    >
      <div>
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-gold via-lapis to-gold"></div>

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
            <h3 className="text-lg font-bold text-slate-100">Trim audio</h3>
            <p className="text-xs text-slate-400">
              Drag the ruler to move the playhead; drag the amber handles to set what to keep.
            </p>
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
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-mono text-slate-400">
                Playhead <span className="text-lapis-bright">{formatDuration(playhead)}</span>
                <span className="text-slate-400"> / {formatDuration(duration)}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => changeZoom(ZOOM_LEVELS[zoomIndex - 1])}
                  disabled={zoomIndex <= 0}
                  title="Zoom out"
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 rounded-lg border border-slate-700 transition-colors"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-[11px] font-mono text-slate-400 w-8 text-center">{zoom}x</span>
                <button
                  onClick={() => changeZoom(ZOOM_LEVELS[zoomIndex + 1])}
                  disabled={zoomIndex >= ZOOM_LEVELS.length - 1}
                  title="Zoom in"
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 rounded-lg border border-slate-700 transition-colors"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div
              ref={viewportRef}
              className="relative w-full overflow-x-auto overflow-y-hidden bg-slate-950 rounded-lg border border-slate-800"
            >
              {/* `overflow-hidden` clips the half-handle that hangs past each end
                  when the selection is at 0:00 or the very end -- without it the
                  spill makes the viewport scrollable by 10px even at 1x zoom. */}
              <div
                ref={trackRef}
                className="relative select-none overflow-hidden touch-none cursor-text"
                style={{ width: `${zoom * 100}%` }}
                onPointerDown={e => {
                  stopAtSelectionEndRef.current = false;
                  seek(xToTime(e.clientX));
                  setDragging('playhead');
                }}
              >
                {/* Ruler */}
                <div className="relative h-5 border-b border-slate-800/80">
                  {ticks.map(tick => (
                    <div
                      key={tick.time}
                      className="absolute top-0 bottom-0 border-l border-slate-800 pl-1 text-[9px] font-mono text-slate-400 leading-5 whitespace-nowrap"
                      style={{ left: `${pct(tick.time)}%` }}
                    >
                      {tick.label}
                    </div>
                  ))}
                </div>

                {/* Waveform + selection */}
                <div className="relative h-24 overflow-hidden">
                  <Waveform peaks={peaks} width={bucketCount * 2} />

                  {/* Cut-out shading */}
                  <div className="absolute inset-y-0 left-0 bg-slate-950/75" style={{ width: `${startPct}%` }} />
                  <div className="absolute inset-y-0 right-0 bg-slate-950/75" style={{ width: `${100 - endPct}%` }} />

                  {/* Kept region border */}
                  <div
                    className="absolute inset-y-0 border-x-2 border-amber-400 pointer-events-none"
                    style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
                  />
                </div>

                {/* The playhead's line spans the full height but is inert -- only
                    the knob, which sits in the ruler strip, is grabbable. That
                    splits the two jobs cleanly by region: the ruler drives the
                    playhead, the waveform below belongs to the trim handles, so
                    a playhead parked next to a handle can't steal its drag. */}
                <div
                  className="absolute inset-y-0 -ml-px w-0.5 bg-lapis-bright pointer-events-none shadow-[0_0_7px_rgba(109,149,224,0.8)]"
                  style={{ left: `${playheadPct}%` }}
                />
                <div
                  onPointerDown={e => {
                    e.stopPropagation();
                    stopAtSelectionEndRef.current = false;
                    setDragging('playhead');
                  }}
                  title="Drag to move the playhead"
                  className="absolute top-0 h-5 -ml-2.5 w-5 cursor-ew-resize flex justify-center items-start pt-0.5 touch-none group"
                  style={{ left: `${playheadPct}%` }}
                >
                  <div className="w-2.5 h-2.5 rounded-full bg-lapis-bright group-hover:bg-lapis ring-2 ring-slate-950/60" />
                </div>

                {/* Trim handles -- `top-5` keeps them clear of the ruler (h-5). */}
                <div
                  onPointerDown={e => {
                    e.stopPropagation();
                    setDragging('start');
                  }}
                  title="Drag to move the start of the selection"
                  className="absolute top-5 bottom-0 -ml-2.5 w-5 cursor-ew-resize flex items-center justify-center touch-none group"
                  style={{ left: `${startPct}%` }}
                >
                  <div className="w-1.5 h-12 rounded-full bg-amber-400 group-hover:bg-amber-300 shadow-lg" />
                </div>
                <div
                  onPointerDown={e => {
                    e.stopPropagation();
                    setDragging('end');
                  }}
                  title="Drag to move the end of the selection"
                  className="absolute top-5 bottom-0 -ml-2.5 w-5 cursor-ew-resize flex items-center justify-center touch-none group"
                  style={{ left: `${endPct}%` }}
                >
                  <div className="w-1.5 h-12 rounded-full bg-amber-400 group-hover:bg-amber-300 shadow-lg" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-4">
              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-1">Start (m:ss.s)</label>
                <input
                  type="text"
                  inputMode="text"
                  placeholder="0:00.0"
                  value={startDraft ?? formatDuration(trimStart)}
                  onFocus={() => setStartDraft(formatDuration(trimStart))}
                  onChange={e => setStartDraft(e.target.value)}
                  onBlur={e => commitStart(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setStartDraft(null);
                  }}
                  className={timecodeInputClass}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-1">End (m:ss.s)</label>
                <input
                  type="text"
                  inputMode="text"
                  placeholder="0:00.0"
                  value={endDraft ?? formatDuration(trimEnd)}
                  onFocus={() => setEndDraft(formatDuration(trimEnd))}
                  onChange={e => setEndDraft(e.target.value)}
                  onBlur={e => commitEnd(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setEndDraft(null);
                  }}
                  className={timecodeInputClass}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-1">Selected length</label>
                <div className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-emerald-400 font-mono">
                  {formatDuration(trimmedDuration)}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-4">
              <button
                onClick={() => togglePlayback(false)}
                title="Play from the playhead"
                className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-700 transition-colors flex items-center gap-1.5"
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>{isPlaying ? 'Pause' : 'Play'}</span>
              </button>
              <button
                onClick={() => togglePlayback(true)}
                title="Play only the selected region"
                className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-700 transition-colors"
              >
                Preview selection
              </button>
              <div className="w-px h-6 bg-slate-800" />
              <button
                onClick={() => setTrimStart(Math.min(playhead, trimEnd - MIN_TRIM_SECONDS))}
                title="Move the start to the playhead"
                className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold rounded-lg border border-slate-700 transition-colors flex items-center gap-1.5"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
                <span>Start here</span>
              </button>
              <button
                onClick={() => setTrimEnd(Math.max(playhead, trimStart + MIN_TRIM_SECONDS))}
                title="Move the end to the playhead"
                className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold rounded-lg border border-slate-700 transition-colors flex items-center gap-1.5"
              >
                <span>End here</span>
                <ChevronsRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleReset}
                className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-700 transition-colors flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            </div>

            <audio
              ref={previewRef}
              src={audioUrl}
              className="hidden"
              onTimeUpdate={syncPlayhead}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
            />
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
    </Dialog>
  );
};

/**
 * Static peak-bar waveform. Redrawn only when the peaks or the canvas width
 * change -- both derive from `bucketCount`, so a zoom step that resizes the
 * canvas (which blanks it) always brings new peaks to repaint it with.
 * Memoised so the playhead's per-frame re-render never touches the canvas.
 */
const Waveform = React.memo(function Waveform({ peaks, width }: { peaks: Float32Array | null; width: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--p-accent').trim() || '#b8c7dc';
    const barWidth = width / peaks.length;
    const mid = height / 2;
    for (let i = 0; i < peaks.length; i++) {
      const barHeight = Math.max(1, peaks[i] * mid);
      ctx.fillRect(i * barWidth, mid - barHeight, Math.max(1, barWidth - 1), barHeight * 2);
    }
  }, [peaks, width]);

  return <canvas ref={canvasRef} width={width} height={96} className="w-full h-full opacity-70" />;
});
