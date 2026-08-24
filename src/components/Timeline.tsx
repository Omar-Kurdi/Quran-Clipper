'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Zap, ZoomIn, ZoomOut, Volume2, VolumeX } from 'lucide-react';
import { VerseData } from '@/lib/quranData';
import { loadWaveform } from '@/lib/waveform';
import { formatTime, MIN_SEGMENT } from '@/lib/verseEdits';

interface TimelineProps {
  verses: VerseData[];
  audioUrl: string;
  audioDuration: number;
  currentTime: number;
  isPlaying: boolean;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onSeek: (time: number) => void;
  onPlayPause: () => void;
  /** Drag of a segment edge. Committed continuously so the preview tracks it. */
  onMoveBoundary: (index: number, edge: 'startTime' | 'endTime', value: number) => void;
  /** SPACEBAR / button: end the current segment here and start the next. */
  onMarkHere: () => void;
  isMuted: boolean;
  volume: number;
  onToggleMute: () => void;
  onVolume: (v: number) => void;
}

const ZOOMS = [1, 2, 4, 8];

/**
 * The timeline.
 *
 * The studio's central object is ayahs positioned in time, and it used to be
 * drawn as a vertical stack of 353px cards in a 420px column -- 2577px of
 * scroll to see 36 seconds. Nothing about that showed duration, order or
 * proportion, and a boundary could only be changed by typing a number.
 *
 * Here each ayah is a block whose width *is* its duration, sitting on the
 * waveform of the actual audio. Dragging an edge is the timing edit. One
 * playhead is the only clock in the app.
 */
export const Timeline: React.FC<TimelineProps> = ({
  verses, audioUrl, audioDuration, currentTime, isPlaying,
  selectedIndex, onSelect, onSeek, onPlayPause, onMoveBoundary, onMarkHere,
  isMuted, volume, onToggleMute, onVolume
}) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  // The load result is stamped with the url it belongs to, so "still loading"
  // is derived rather than stored -- setting a loading flag synchronously
  // inside the effect is what react-hooks/set-state-in-effect rejects, and
  // deriving it also cannot go stale when the url changes mid-flight.
  const [loaded, setLoaded] = useState<{ url: string; peaks: Float32Array | null } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ index: number; edge: 'startTime' | 'endTime' } | null>(null);

  // Read by the pointer handler so a drag does not rebuild its listeners on
  // every frame as the verses change underneath it.
  const dragRef = useRef(drag);
  const movedRef = useRef(onMoveBoundary);
  useEffect(() => {
    dragRef.current = drag;
    movedRef.current = onMoveBoundary;
  }, [drag, onMoveBoundary]);

  useEffect(() => {
    if (!audioUrl) return;
    const controller = new AbortController();
    loadWaveform(audioUrl, controller.signal).then(result => {
      if (!controller.signal.aborted) setLoaded({ url: audioUrl, peaks: result });
    });
    return () => controller.abort();
  }, [audioUrl]);

  const settled = loaded?.url === audioUrl;
  const peaks = settled ? loaded!.peaks : null;
  const waveformState: 'idle' | 'loading' | 'ready' | 'unavailable' =
    !audioUrl ? 'idle' : !settled ? 'loading' : loaded!.peaks ? 'ready' : 'unavailable';

  const duration = audioDuration || Math.max(...verses.map(v => v.endTime), 1);
  const pct = useCallback((t: number) => (duration > 0 ? (t / duration) * 100 : 0), [duration]);

  const xToTime = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el || duration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration;
  }, [duration]);

  // Edge dragging via window listeners, so the pointer can leave the 8px grab
  // strip without dropping the drag.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d) movedRef.current(d.index, d.edge, xToTime(e.clientX));
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, xToTime]);

  // Keep the playhead in view when zoomed in.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || zoom === 1 || !isPlaying) return;
    const x = (currentTime / duration) * vp.scrollWidth;
    const margin = vp.clientWidth * 0.15;
    if (x < vp.scrollLeft + margin || x > vp.scrollLeft + vp.clientWidth - margin) {
      vp.scrollLeft = Math.max(0, Math.min(x - vp.clientWidth / 2, vp.scrollWidth - vp.clientWidth));
    }
  }, [currentTime, duration, zoom, isPlaying]);

  const ticks = useMemo(() => {
    if (duration <= 0) return [];
    const visible = duration / zoom;
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find(s => s >= visible / 8) ?? 300;
    const out: number[] = [];
    for (let t = 0; t <= duration; t += step) out.push(t);
    return out;
  }, [duration, zoom]);

  const zoomIndex = ZOOMS.indexOf(zoom);

  return (
    <section aria-label="Timeline" className="shrink-0 border-t border-slate-800 bg-slate-900/70 backdrop-blur-sm">
      {/* Transport. Everything that controls time is on this bar, so there is
          one clock rather than a scrubber here and nudge buttons elsewhere. */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800/70">
        <button
          onClick={onPlayPause}
          aria-label={isPlaying ? 'Pause recitation' : 'Play recitation'}
          className="p-2 bg-gold hover:bg-gold-bright text-ink rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-bright focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
        >
          {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
        </button>
        <button
          onClick={() => onSeek(0)}
          aria-label="Back to start"
          title="Back to start"
          className="p-2 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <span className="font-mono text-[11px] text-slate-300 tabular-nums px-1">
          {formatTime(currentTime)} <span className="text-slate-400">/ {formatTime(duration)}</span>
        </span>

        {/* Tap-to-sync lives on the timeline, next to the thing being marked --
            it used to sit in the far panel while the preview played opposite. */}
        <button
          onClick={onMarkHere}
          title="Mark the end of this ayah at the playhead (SPACEBAR)"
          className="ml-1 flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-semibold rounded-lg border border-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden sm:inline">Mark ayah end</span>
          <kbd className="hidden md:inline font-mono text-[10px] text-slate-400 border border-slate-600 rounded px-1">SPACE</kbd>
        </button>

        <span className="flex-1" />

        <button
          onClick={onToggleMute}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
          title={isMuted ? 'Unmute' : 'Mute'}
          className="p-1.5 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors"
        >
          {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={isMuted ? 0 : volume}
          onChange={e => onVolume(parseFloat(e.target.value))}
          aria-label="Volume"
          className="hidden sm:block w-16 accent-amber-500"
        />

        <span className="hidden md:inline font-mono text-[11px] text-slate-400">
          {waveformState === 'loading' && 'reading audio…'}
          {waveformState === 'unavailable' && 'waveform unavailable'}
        </span>
        <button
          onClick={() => setZoom(ZOOMS[zoomIndex - 1])}
          disabled={zoomIndex <= 0}
          aria-label="Zoom out"
          className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded-lg border border-slate-700 transition-colors"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <span className="font-mono text-[11px] text-slate-400 w-7 text-center">{zoom}x</span>
        <button
          onClick={() => setZoom(ZOOMS[zoomIndex + 1])}
          disabled={zoomIndex >= ZOOMS.length - 1}
          aria-label="Zoom in"
          className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded-lg border border-slate-700 transition-colors"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
      </div>

      <div ref={viewportRef} className="overflow-x-auto overflow-y-hidden">
        <div ref={trackRef} className="relative select-none" style={{ width: `${zoom * 100}%` }}>
          {/* Ruler */}
          <div className="relative h-4 border-b border-slate-800/70">
            {ticks.map(t => (
              <span
                key={t}
                className="absolute top-0 bottom-0 border-l border-slate-800 pl-1 text-[9px] font-mono text-slate-400 leading-4 whitespace-nowrap"
                style={{ left: `${pct(t)}%` }}
              >
                {formatTime(t)}
              </span>
            ))}
          </div>

          {/* Waveform + ayah blocks. Clicking empty track seeks. */}
          <div
            className="relative h-20 touch-none cursor-text"
            onPointerDown={e => { if (e.target === e.currentTarget) onSeek(xToTime(e.clientX)); }}
          >
            <Waveform peaks={peaks} />

            {verses.map((verse, i) => {
              const left = pct(verse.startTime);
              const width = Math.max(0.4, pct(verse.endTime) - left);
              const active = i === selectedIndex;
              return (
                <div
                  key={`${verse.verseKey}-${i}`}
                  className={`absolute top-1 bottom-1 rounded-md border overflow-hidden transition-colors ${
                    active
                      ? 'bg-gold/25 border-gold ring-1 ring-gold/50 z-10'
                      : 'bg-slate-800/55 border-slate-600 hover:bg-slate-700/60'
                  }`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                >
                  <button
                    onClick={() => { onSelect(i); onSeek(verse.startTime); }}
                    title={`${verse.verseKey} · ${formatTime(verse.endTime - verse.startTime)}`}
                    className="absolute inset-0 px-2 flex flex-col justify-center items-start text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold-bright"
                  >
                    <span className={`font-mono text-[10px] truncate w-full ${active ? 'text-gold-bright' : 'text-slate-300'}`}>
                      {verse.verseKey}
                    </span>
                    <span className="font-amiri text-[13px] truncate w-full text-parchment/90" dir="rtl">
                      {verse.displayTextUthmani || verse.textUthmani}
                    </span>
                  </button>

                  {/* Grab strips. Inside the block so they can never be orphaned
                      from it, and above the seek surface so a drag never seeks. */}
                  <span
                    onPointerDown={e => { e.stopPropagation(); onSelect(i); setDrag({ index: i, edge: 'startTime' }); }}
                    role="separator"
                    aria-label={`Move start of ${verse.verseKey}`}
                    className="absolute inset-y-0 left-0 w-2 cursor-ew-resize touch-none hover:bg-gold/50"
                  />
                  <span
                    onPointerDown={e => { e.stopPropagation(); onSelect(i); setDrag({ index: i, edge: 'endTime' }); }}
                    role="separator"
                    aria-label={`Move end of ${verse.verseKey}`}
                    className="absolute inset-y-0 right-0 w-2 cursor-ew-resize touch-none hover:bg-gold/50"
                  />
                </div>
              );
            })}

            {/* Playhead */}
            <span
              className="absolute inset-y-0 -ml-px w-0.5 bg-lapis-bright pointer-events-none z-20 shadow-[0_0_7px_rgba(109,149,224,0.8)]"
              style={{ left: `${pct(currentTime)}%` }}
            />
          </div>
        </div>
      </div>

      {verses.length === 0 && (
        <p className="px-3 py-4 text-[11px] text-slate-400 text-center">
          No ayahs loaded yet — pick a surah on the left, or upload a recitation.
        </p>
      )}
    </section>
  );
};

/** Static peak bars. Redrawn only when the peaks change. */
const Waveform = React.memo(function Waveform({ peaks }: { peaks: Float32Array | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    if (!peaks) return;
    ctx.fillStyle = 'rgba(148, 138, 168, 0.45)';
    const barWidth = width / peaks.length;
    const mid = height / 2;
    for (let i = 0; i < peaks.length; i++) {
      const h = Math.max(1, peaks[i] * mid * 0.92);
      ctx.fillRect(i * barWidth, mid - h, Math.max(1, barWidth - 0.5), h * 2);
    }
  }, [peaks]);
  return <canvas ref={canvasRef} width={1800} height={80} className="absolute inset-0 w-full h-full" />;
});
