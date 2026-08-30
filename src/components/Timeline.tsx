'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Zap, ZoomIn, ZoomOut, Volume2, VolumeX, Scissors } from 'lucide-react';
import { VerseData } from '@/lib/quranData';
import { loadWaveform } from '@/lib/waveform';
import { formatTime, MIN_SEGMENT } from '@/lib/verseEdits';
import { BackgroundSegment, backgroundLabel } from '@/lib/backgroundTimeline';

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
  /** B key / button: end the current segment here and start the next. */
  onMarkHere: () => void;
  /** Opens the trim modal. Omitted when there is no uploaded file to trim. */
  onTrim?: () => void;
  /**
   * Cuts the uploaded audio down to `[start, end]` of the current clip.
   *
   * The same edit the trim dialog makes, reachable without covering the thing
   * being trimmed: the handles live on this timeline, and dragging one moves the
   * playhead with it, so the preview above shows the moment being cut to.
   */
  onTrimRange?: (start: number, end: number) => void;
  /** Length of the uploaded clip, shown on the trim button. */
  trimHint?: string;
  isMuted: boolean;
  volume: number;
  onToggleMute: () => void;
  onVolume: (v: number) => void;
  /**
   * Where each background sits in time, so the clip changes are visible against
   * the ayahs rather than only discoverable by watching the preview.
   */
  backgroundSegments?: BackgroundSegment[];
  /** Drag of a background block's body: where the user wants it to start. */
  onMoveBackground?: (index: number, desiredStart: number) => void;
  /** Drag of a background block's edge. Extending simply loops the clip. */
  onResizeBackground?: (index: number, edge: 'start' | 'end', value: number) => void;
  /** Selecting a block, so the panel can act on the same one the eye is on. */
  selectedBackground?: number | null;
  onSelectBackground?: (index: number | null) => void;
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
  onTrim, onTrimRange, trimHint, isMuted, volume, onToggleMute, onVolume,
  backgroundSegments = [], onMoveBackground, onResizeBackground,
  selectedBackground = null, onSelectBackground
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

  // A ref, not state: the ruler captures the pointer, so this only has to
  // survive between events -- re-rendering the whole timeline on every
  // pointermove of a scrub would be the one thing that makes it feel heavy.
  const scrubbingRef = useRef(false);

  /**
   * A background block being dragged: which one, which handle, and -- for a
   * body drag -- how far into the block the pointer landed, so it does not
   * jump its own left edge under the cursor on the first move.
   */
  const [bgDrag, setBgDrag] = useState<{ index: number; edge: 'start' | 'end' | 'move'; grabOffset: number } | null>(null);
  const bgDragRef = useRef(bgDrag);
  const bgMoveRef = useRef(onMoveBackground);
  const bgResizeRef = useRef(onResizeBackground);
  useEffect(() => {
    bgDragRef.current = bgDrag;
    bgMoveRef.current = onMoveBackground;
    bgResizeRef.current = onResizeBackground;
  }, [bgDrag, onMoveBackground, onResizeBackground]);

  /**
   * The stretch of audio to keep, while it is being chosen.
   *
   * Stamped with the url it was chosen against, so it is discarded rather than
   * misapplied when the audio changes underneath it -- including the moment a
   * trim lands, which replaces the file with the shorter one.
   */
  const [clip, setClip] = useState<{ url: string; start: number; end: number } | null>(null);
  const [clipDrag, setClipDrag] = useState<'start' | 'end' | null>(null);

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
    // Ignore a late answer rather than cancelling it -- the fetch is shared and
    // cached, so cancelling would rob any other listener of the same result.
    let stale = false;
    loadWaveform(audioUrl).then(result => {
      if (!stale) setLoaded({ url: audioUrl, peaks: result });
    });
    return () => { stale = true; };
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

  // Background blocks drag the same way, through the same window listeners.
  useEffect(() => {
    if (!bgDrag) return;
    const move = (e: PointerEvent) => {
      const d = bgDragRef.current;
      if (!d) return;
      const t = xToTime(e.clientX);
      if (d.edge === 'move') bgMoveRef.current?.(d.index, t - d.grabOffset);
      else bgResizeRef.current?.(d.index, d.edge, t);
    };
    const up = () => setBgDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [bgDrag, xToTime]);

  /**
   * Dragging a clip handle also seeks.
   *
   * That is the whole point of trimming here rather than in a dialog: the
   * preview is right above this, so the frame and the sound at the cut are
   * visible while it is being placed.
   */
  useEffect(() => {
    if (!clipDrag) return;
    const move = (e: PointerEvent) => {
      const t = xToTime(e.clientX);
      setClip(prev => {
        const current = prev ?? { url: audioUrl, start: 0, end: duration };
        const next = clipDrag === 'start'
          ? { ...current, url: audioUrl, start: Math.min(t, current.end - MIN_SEGMENT) }
          : { ...current, url: audioUrl, end: Math.max(t, current.start + MIN_SEGMENT) };
        return { ...next, start: Math.max(0, next.start), end: Math.min(duration, next.end) };
      });
      onSeek(Math.max(0, Math.min(t, duration)));
    };
    const up = () => setClipDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [clipDrag, xToTime, duration, audioUrl, onSeek]);

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

  // A selection made against another file is no selection at all.
  const clipRange = clip && clip.url === audioUrl ? clip : { start: 0, end: duration };
  const clipIsWhole = clipRange.start <= 0.05 && clipRange.end >= duration - 0.05;

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
          title="Mark the end of this ayah at the playhead (B)"
          className="ml-1 flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-semibold rounded-lg border border-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden sm:inline">Mark ayah end</span>
          <kbd className="hidden md:inline font-mono text-[10px] text-slate-400 border border-slate-600 rounded px-1">B</kbd>
        </button>

        {/* Trimming belongs beside marking: both are edits to where the audio
            starts and stops, and both are things you reach for repeatedly
            while working the timeline. */}
        {onTrim && (
          <button
            onClick={onTrim}
            title="Trim the uploaded audio — your timeline edits are kept"
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-semibold rounded-lg border border-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <Scissors className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Trim audio</span>
            {trimHint && <span className="hidden md:inline font-mono text-[10px] text-slate-400">{trimHint}</span>}
          </button>
        )}

        {/* Only offered once the handles have actually been moved: a button that
            cuts the clip to exactly itself is a button that does nothing. */}
        {onTrimRange && !clipIsWhole && (
          <>
            <button
              onClick={() => onTrimRange(clipRange.start, clipRange.end)}
              title={`Cut the audio down to ${formatTime(clipRange.start)} – ${formatTime(clipRange.end)}`}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gold hover:bg-gold-bright text-ink text-[11px] font-bold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              <Scissors className="w-3.5 h-3.5" />
              <span>Keep {formatTime(clipRange.end - clipRange.start)}</span>
            </button>
            <button
              onClick={() => setClip(null)}
              title="Put the clip handles back to the whole recording"
              className="px-2 py-1.5 text-[11px] font-semibold text-slate-300 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors"
            >
              Reset
            </button>
          </>
        )}

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
          {/* Clip handles.

              A strip of its own above the ruler, so grabbing one can never be
              confused with scrubbing, dragging an ayah edge or moving a
              background block. What falls outside is dimmed all the way down
              the timeline -- the cut has to be legible against the ayahs it
              will take with it, not just against its own row. */}
          {onTrimRange && (
            <div className="relative h-4 border-b border-slate-800/70 bg-slate-950/60">
              <span
                className="absolute inset-y-0 left-0 bg-slate-950/70 pointer-events-none"
                style={{ width: `${pct(clipRange.start)}%` }}
              />
              <span
                className="absolute inset-y-0 right-0 bg-slate-950/70 pointer-events-none"
                style={{ width: `${Math.max(0, 100 - pct(clipRange.end))}%` }}
              />
              <span
                className="absolute inset-y-0 border-x-2 border-gold/80 pointer-events-none"
                style={{ left: `${pct(clipRange.start)}%`, width: `${Math.max(0, pct(clipRange.end) - pct(clipRange.start))}%` }}
              />
              {(['start', 'end'] as const).map(edge => (
                <span
                  key={edge}
                  onPointerDown={e => {
                    e.stopPropagation();
                    setClipDrag(edge);
                    onSeek(xToTime(e.clientX));
                  }}
                  role="separator"
                  aria-label={edge === 'start' ? 'Move the start of the clip' : 'Move the end of the clip'}
                  title={edge === 'start' ? 'Drag to move where the audio starts' : 'Drag to move where the audio ends'}
                  className="absolute inset-y-0 -ml-2 w-4 cursor-ew-resize touch-none hover:bg-gold/40"
                  style={{ left: `${pct(edge === 'start' ? clipRange.start : clipRange.end)}%` }}
                />
              ))}
              <span className="absolute left-1 top-0 text-[9px] font-mono leading-4 text-slate-400 pointer-events-none">
                clip
              </span>
            </div>
          )}
          {/* Ruler. Click or drag anywhere along it to move the playhead --
              the tick labels are inert so a click near "10.0s" scrubs rather
              than landing on the label and doing nothing. */}
          <div
            className="relative h-5 border-b border-slate-800/70 cursor-ew-resize touch-none"
            role="slider"
            aria-label="Playhead"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(currentTime)}
            aria-valuetext={formatTime(currentTime)}
            tabIndex={0}
            onPointerDown={e => {
              // Seek first. Capture is what keeps a drag alive once the pointer
              // leaves the 20px strip, but it is also the one call here that can
              // throw -- and a throw before the seek would lose the click.
              scrubbingRef.current = true;
              onSeek(xToTime(e.clientX));
              try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* drag ends at the strip edge */ }
            }}
            onPointerMove={e => { if (scrubbingRef.current) onSeek(xToTime(e.clientX)); }}
            onPointerUp={e => {
              scrubbingRef.current = false;
              try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* never captured */ }
            }}
            onPointerCancel={() => { scrubbingRef.current = false; }}
            onKeyDown={e => {
              const step = e.shiftKey ? 1 : 0.1;
              if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek(Math.max(0, currentTime - step)); }
              if (e.key === 'ArrowRight') { e.preventDefault(); onSeek(Math.min(duration, currentTime + step)); }
            }}
          >
            {ticks.map(t => (
              <span
                key={t}
                className="absolute top-0 bottom-0 border-l border-slate-800 pl-1 text-[9px] font-mono text-slate-400 leading-5 whitespace-nowrap pointer-events-none"
                style={{ left: `${pct(t)}%` }}
              >
                {formatTime(t)}
              </span>
            ))}
            <span
              className="absolute inset-y-0 -ml-px w-0.5 bg-lapis-bright pointer-events-none"
              style={{ left: `${pct(currentTime)}%` }}
            />
          </div>

          {/* Background lane.

              Each block is where one clip plays. In the automatic modes it is
              read-only -- the times come from the ayahs or a timer, so there is
              nothing to drag. Once a block is dragged the layout is baked to a
              hand-cut lane and stays where it is put. Empty space is a real
              gap: nothing plays there and the frame falls back to its gradient. */}
          {backgroundSegments.length > 0 && (
            <div
              className="relative h-7 border-b border-slate-800/70 bg-slate-950/40"
              aria-label="Backgrounds"
              onPointerDown={e => { if (e.target === e.currentTarget) onSelectBackground?.(null); }}
            >
              {backgroundSegments.map((seg, i) => {
                const left = pct(seg.start);
                const width = Math.max(0.3, pct(seg.end) - left);
                const editable = Boolean(onMoveBackground && onResizeBackground);
                const active = selectedBackground === i;
                return (
                  <div
                    key={`${seg.url}-${i}`}
                    title={`${backgroundLabel(seg.url)} · ${formatTime(seg.start)} – ${formatTime(seg.end)}${
                      editable ? ' · drag to move, drag an edge to resize' : ''
                    }`}
                    onPointerDown={e => {
                      onSelectBackground?.(i);
                      if (!editable) return;
                      e.stopPropagation();
                      setBgDrag({ index: i, edge: 'move', grabOffset: xToTime(e.clientX) - seg.start });
                    }}
                    className={`absolute inset-y-0.5 rounded-sm border overflow-hidden flex items-center touch-none ${
                      editable ? 'cursor-grab active:cursor-grabbing' : ''
                    } ${
                      active
                        ? 'border-lapis-bright bg-lapis-bright/30 ring-1 ring-lapis-bright/60 z-10'
                        : 'border-lapis-bright/40 bg-lapis-bright/15 hover:bg-lapis-bright/25'
                    }`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    <span className="px-1 text-[9px] leading-none text-slate-300 truncate pointer-events-none">
                      {backgroundLabel(seg.url)}
                    </span>

                    {/* Resize handles, inside the block and above the body drag
                        so grabbing an edge never turns into a move. */}
                    {editable && (['start', 'end'] as const).map(edge => (
                      <span
                        key={edge}
                        onPointerDown={e => {
                          e.stopPropagation();
                          onSelectBackground?.(i);
                          setBgDrag({ index: i, edge, grabOffset: 0 });
                        }}
                        role="separator"
                        aria-label={`Move ${edge === 'start' ? 'start' : 'end'} of ${backgroundLabel(seg.url)}`}
                        className={`absolute inset-y-0 w-2 cursor-ew-resize touch-none hover:bg-lapis-bright/60 ${
                          edge === 'start' ? 'left-0' : 'right-0'
                        }`}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}

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

            {/* What the clip handles above would cut away. */}
            {onTrimRange && !clipIsWhole && (
              <>
                <span
                  className="absolute inset-y-0 left-0 bg-slate-950/65 pointer-events-none z-10"
                  style={{ width: `${pct(clipRange.start)}%` }}
                />
                <span
                  className="absolute inset-y-0 right-0 bg-slate-950/65 pointer-events-none z-10"
                  style={{ width: `${Math.max(0, 100 - pct(clipRange.end))}%` }}
                />
              </>
            )}

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
