'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Loader2, Maximize2, Minimize2, Pause, Play, RotateCcw, Scissors, Undo2, Wind, X } from 'lucide-react';
import { Dialog } from './Dialog';
import { useT } from './LocaleProvider';
import { formatDuration } from './AudioTrimModal';
import { AudioEditWaveform, CaptionLane, WAVE_BUCKETS, type Selection } from './AudioEditWaveform';
import { audioBufferToWav, computePeaks, decodeAudioFile } from '@/lib/audioTrim';
import {
  MAX_TEMPO, MIN_CUT_SEC, NO_EDIT, editedLength, encodeEdit, normalizeEdit, withCuts,
  type AudioCut, type AudioEdit, type Span,
} from '@/lib/audioEdit';
import { fitToLength, openingCut, pauseCuts, silencesWithin, silentSpans, voiceSpan, withAutoCuts, type FitResult } from '@/lib/audioEditPlan';
import { useVolume } from '@/hooks/useVolume';
import type { VerseData } from '@/lib/quranData';

type Source = { kind: 'file'; file: File } | { kind: 'url'; url: string };

interface AudioEditModalProps {
  isOpen: boolean;
  /** The recording itself, unedited: an upload, or a built-in reciter's passage. */
  source: Source;
  /** The edit in force now, on the source's clock: Apply is offered when the draft differs from it. */
  edit: AudioEdit;
  /** What the draft starts as: the edit in force, or a first edit's defaults. */
  initial: AudioEdit;
  /** How long what plays now is, as the timeline reads it. */
  nowLength: number;
  /** The captions, on the source's clock. */
  captions: VerseData[];
  /** A recording of one's own: offers the clean-up and the trim to the voice. */
  isUpload: boolean;
  /** The upload's own video is the background, which cuts and a speed-up leave behind. */
  videoBackground: boolean;
  onCancel: () => void;
  onApply: (edit: AudioEdit) => void;
}

/** Lengths short videos are held to: YouTube Shorts and TikTok's first tier, then Reels. */
const TARGETS = [60, 90];

/**
 * Edit audio: cuts anywhere in the recording, pauses shortened by hand or
 * automatically, a gentle speed-up, and the clean-ups the server applies.
 *
 * Everything here is on the source's clock, the waveform included: a cut is a
 * stretch of the recording as recorded, and the preview plays it skipping the
 * cuts at the chosen speed, the browser keeping the pitch as it goes. What is
 * applied is rendered by the server (`audioRender`), with Rubber Band for the
 * speed; this preview is the browser's own time-stretch of the same edit.
 */
export const AudioEditModal: React.FC<AudioEditModalProps> = ({
  isOpen, source, edit, initial, nowLength, captions, isUpload, videoBackground, onCancel, onApply,
}) => {
  const t = useT();
  const recording = useRecording(source);
  // Larger is the whole point of expanding: everything in it is drawn bigger, not just given room.
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<AudioEdit>(initial);
  const [selection, setSelection] = useState<Selection>(null);
  const { audioRef, playing, playhead, toggle, seek, events } = usePreview(recording.previewUrl, draft);
  const duration = recording.duration;
  const update = (next: AudioEdit) => setDraft(normalizeEdit(next, duration || undefined));
  const ready = recording.state === 'ready' && recording.peaks;
  return (
    <Dialog isOpen={isOpen} onClose={onCancel} label={t.editAudio.dialogLabel} panelClassName="relative max-w-full max-h-[96vh] overflow-auto">
      <div
        style={{ zoom: expanded ? 1.3 : 1 }}
        className={`relative bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col gap-4 text-sm ${expanded ? 'w-[72vw]' : 'w-[min(76rem,96vw)]'}`}
      >
        <EditHeader onClose={onCancel} expanded={expanded} onExpand={() => setExpanded(!expanded)} />
        <ReadingState state={recording.state} />
        {ready && (
          <>
            <audio ref={audioRef} src={recording.previewUrl} preload="auto" {...events} />
            <Transport playing={playing} playhead={playhead} onToggle={toggle} was={nowLength} now={editedLength(draft, duration)} />
            <AudioEditWaveform
              peaks={recording.peaks!} duration={duration} draft={draft} selection={selection} playhead={playhead} tall={expanded}
              onDraft={setDraft} onSelection={setSelection} onSeek={seek}
            />
            <CaptionLane captions={captions} duration={duration} onSelect={setSelection} />
            <SelectionBar
              selection={selection} draft={draft} duration={duration} pauses={recording.silences} captions={captions}
              onDraft={update} onSelection={setSelection}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <PauseAndSpeed draft={draft} duration={duration} pauses={recording.silences} captions={captions} onDraft={update} />
              <FitAndCleanUp draft={draft} duration={duration} pauses={recording.silences} captions={captions} isUpload={isUpload} onDraft={update} />
            </div>
            <QuickCuts
              draft={draft} duration={duration} captions={captions} voice={isUpload ? recording.voice : null}
              onDraft={update} onReset={() => { update(NO_EDIT); setSelection(null); }}
            />
            {videoBackground && (draft.cuts.length > 0 || draft.tempo !== 1) && <p className="text-xs text-amber-300">{t.editAudio.videoBackgroundWarning}</p>}
          </>
        )}
        <EditFooter canApply={!!ready && encodeEdit(draft) !== encodeEdit(edit)} onCancel={onCancel} onApply={() => onApply(draft)} />
      </div>
    </Dialog>
  );
};

const EditFooter: React.FC<{ canApply: boolean; onCancel: () => void; onApply: () => void }> = ({ canApply, onCancel, onApply }) => {
  const t = useT();
  return (
    <footer className="flex items-center justify-end gap-2 border-t border-slate-800 pt-3">
      <button onClick={onCancel} className={BUTTON}>{t.common.cancel}</button>
      <button onClick={onApply} disabled={!canApply} className={`${BUTTON_STRONG} disabled:opacity-50`}>{t.editAudio.apply}</button>
    </footer>
  );
};

const BUTTON = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 disabled:opacity-50';
const BUTTON_STRONG = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold rounded-lg bg-gold hover:bg-gold-bright text-ink';

interface Recording {
  state: 'reading' | 'ready' | 'failed';
  peaks: Float32Array | null;
  duration: number;
  voice: Span | null;
  /** Where nothing but the room is heard (`silentSpans`): all that shortening a pause may cut. */
  silences: Span[];
  previewUrl: string;
}

/** The address of a recording on this studio, refused for any other origin. */
function onThisStudio(address: string): URL {
  const url = new URL(address, window.location.origin);
  if (url.origin !== window.location.origin) throw new Error('not a recording on this studio');
  return url;
}

/**
 * The recording, read once: peaks to draw, the voice's edges, and something
 * to play. An upload plays from its decoded samples, on the clock the
 * waveform is drawn on; a variable-bitrate file's own header can be seconds out.
 */
function useRecording(source: Source): Recording {
  const [recording, setRecording] = useState<Recording>({ state: 'reading', peaks: null, duration: 0, voice: null, silences: [], previewUrl: '' });
  useEffect(() => {
    let stale = false;
    let made = '';
    (async () => {
      const blob = source.kind === 'file' ? source.file : await (await fetch(onThisStudio(source.url))).blob();
      const buffer = await decodeAudioFile(blob);
      if (stale) return;
      made = source.kind === 'file' ? URL.createObjectURL(audioBufferToWav(buffer)) : source.url;
      setRecording({
        state: 'ready',
        peaks: computePeaks(buffer, WAVE_BUCKETS),
        duration: buffer.duration,
        voice: voiceSpan(buffer.getChannelData(0), buffer.sampleRate),
        silences: silentSpans(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)), buffer.sampleRate),
        previewUrl: made,
      });
    })().catch(() => {
      if (!stale) setRecording(prev => ({ ...prev, state: 'failed' }));
    });
    return () => {
      stale = true;
      if (made.startsWith('blob:')) URL.revokeObjectURL(made);
    };
  }, [source]);
  return recording;
}

/** Playback that skips what is cut, at the chosen speed, the browser keeping the pitch. */
function usePreview(previewUrl: string, draft: AudioEdit) {
  const volume = useVolume();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = draft.tempo;
    audio.preservesPitch = true;
    audio.volume = volume;
  }, [draft.tempo, volume, previewUrl]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const audio = audioRef.current;
      const inside = audio && skipTo(draft.cuts, audio.currentTime);
      if (audio && inside !== null) audio.currentTime = inside;
      if (audio) setPlayhead(audio.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, draft.cuts]);
  const toggle = () => {
    const audio = audioRef.current;
    if (audio && playing) audio.pause();
    else if (audio) void audio.play().catch(() => setPlaying(false));
  };
  const seek = (time: number) => {
    if (audioRef.current) audioRef.current.currentTime = time;
    setPlayhead(time);
  };
  const events = { onPlay: () => setPlaying(true), onPause: () => setPlaying(false), onEnded: () => setPlaying(false) };
  return { audioRef, playing, playhead, toggle, seek, events };
}

/** Where playback at `time` should jump to, past the cut it is in; null when it is in none. */
function skipTo(cuts: AudioCut[], time: number): number | null {
  const inside = cuts.find(cut => time >= cut.start && time < cut.end - 0.005);
  return inside ? inside.end : null;
}

const EditHeader: React.FC<{ onClose: () => void; expanded: boolean; onExpand: () => void }> = ({ onClose, expanded, onExpand }) => {
  const t = useT();
  const label = expanded ? t.editAudio.shrink : t.editAudio.expand;
  return (
    <header className="flex items-start gap-3">
      <AudioLines className="w-5 h-5 text-amber-400 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <h2 className="text-lg font-semibold text-slate-100">{t.editAudio.title}</h2>
        <p className="text-xs text-slate-400 leading-relaxed">{t.editAudio.help}</p>
      </div>
      <button onClick={onExpand} aria-label={label} title={label} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800">
        {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
      </button>
      <button onClick={onClose} aria-label={t.common.close} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800">
        <X className="w-4 h-4" />
      </button>
    </header>
  );
};

const ReadingState: React.FC<{ state: Recording['state'] }> = ({ state }) => {
  const t = useT();
  if (state === 'reading') return <p className="flex items-center gap-2 text-slate-300"><Loader2 className="w-4 h-4 animate-spin" />{t.editAudio.reading}</p>;
  if (state === 'failed') return <p className="text-red-300">{t.editAudio.readFailed}</p>;
  return null;
};

const Transport: React.FC<{ playing: boolean; playhead: number; onToggle: () => void; was: number; now: number }> = ({
  playing, playhead, onToggle, was, now,
}) => {
  const t = useT();
  return (
    <div className="flex items-center gap-3 font-mono text-xs" dir="ltr">
      <button onClick={onToggle} aria-label={playing ? t.editAudio.pause : t.editAudio.play} className="p-2 bg-gold hover:bg-gold-bright text-ink rounded-full">
        {playing ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
      </button>
      <span className="text-slate-300">{formatDuration(playhead)}</span>
      <span className="flex-1" />
      <span className="text-slate-400">{t.editAudio.lengthWas(formatDuration(was))}</span>
      <span className="font-semibold text-amber-300">{t.editAudio.lengthNow(formatDuration(now))}</span>
    </div>
  );
};

interface PanelProps {
  draft: AudioEdit;
  duration: number;
  onDraft: (edit: AudioEdit) => void;
}

/** What to do with the selection: cut it, shorten it, or put a cut back. */
const SelectionBar: React.FC<PanelProps & {
  selection: Selection; pauses: Span[]; captions: VerseData[]; onSelection: (selection: Selection) => void;
}> = ({ selection, draft, duration, pauses, captions, onDraft, onSelection }) => {
  const t = useT();
  const [keepFor, setKeepFor] = useState(0.5);
  if (!selection) return <p className="min-h-9 text-xs text-slate-400">{t.editAudio.selectHint}</p>;
  const cut = (keep: number) => {
    const shortened = { start: selection.start + keep * 0.6, end: selection.end - keep * 0.4 };
    onDraft(withCuts(draft, [keep > 0 ? shortened : selection], duration));
    onSelection(null);
  };
  const restore = () => {
    onDraft({ ...draft, cuts: draft.cuts.filter((_, i) => i !== selection.cut) });
    onSelection(null);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 min-h-9">
      <span className="font-mono text-xs text-slate-300" dir="ltr">
        {formatDuration(selection.start)} – {formatDuration(selection.end)} ({(selection.end - selection.start).toFixed(2)}s)
      </span>
      {selection.cut !== undefined
        ? <button onClick={restore} className={BUTTON}><Undo2 className="w-3.5 h-3.5" />{t.editAudio.restoreCut}</button>
        : <CutButtons tooShort={selection.end - selection.start - keepFor < MIN_CUT_SEC} keepFor={keepFor} onKeepFor={setKeepFor} onCut={cut} />}
      {selection.cut === undefined && (
        <ShortenSilence selection={selection} pauses={pauses} captions={captions} draft={draft} duration={duration} onDraft={onDraft} onSelection={onSelection} />
      )}
      <button onClick={() => onSelection(null)} className="text-xs text-slate-400 hover:text-slate-100 px-2">{t.editAudio.clearSelection}</button>
    </div>
  );
};

/** The pauses inside the selection shortened, only their silence: the middle ground between by hand and automatic. */
const ShortenSilence: React.FC<PanelProps & {
  selection: Span; pauses: Span[]; captions: VerseData[]; onSelection: (selection: Selection) => void;
}> = ({ selection, pauses, captions, draft, duration, onDraft, onSelection }) => {
  const t = useT();
  // Made by hand, so "Shorten long pauses" turned off leaves them.
  const cuts = pauseCuts(silencesWithin(pauses, selection), captions).map(({ start, end }) => ({ start, end }));
  return (
    <button
      onClick={() => { onDraft(withCuts(draft, cuts, duration)); onSelection(null); }}
      disabled={!cuts.length}
      title={cuts.length ? t.editAudio.shortenSilenceTitle : t.editAudio.noSilenceHere}
      className={BUTTON}
    >
      <Wind className="w-3.5 h-3.5" />{t.editAudio.shortenSilence}
    </button>
  );
};

const CutButtons: React.FC<{ tooShort: boolean; keepFor: number; onKeepFor: (seconds: number) => void; onCut: (keep: number) => void }> = ({
  tooShort, keepFor, onKeepFor, onCut,
}) => {
  const t = useT();
  return (
    <>
      <button onClick={() => onCut(0)} className={BUTTON_STRONG}><Scissors className="w-3.5 h-3.5" />{t.editAudio.deleteSelection}</button>
      <span className="flex items-center gap-1.5">
        <button onClick={() => onCut(keepFor)} disabled={tooShort} className={BUTTON}>{t.editAudio.shortenTo}</button>
        <input
          type="number" min={0.2} max={5} step={0.1} value={keepFor} dir="ltr"
          onChange={e => onKeepFor(Math.max(0.2, Math.min(5, Number(e.target.value) || 0.5)))}
          aria-label={t.editAudio.shortenToSeconds}
          className="w-16 px-2 py-1 rounded-md bg-slate-950 border border-slate-700 font-mono text-xs"
        />
        <span className="text-xs text-slate-400">s</span>
      </span>
    </>
  );
};

interface PlanProps extends PanelProps {
  pauses: Span[];
  captions: VerseData[];
}

/** Shorten long pauses, and the speed. */
const PauseAndSpeed: React.FC<PlanProps> = ({ draft, duration, pauses, captions, onDraft }) => {
  const t = useT();
  const auto = useMemo(() => pauseCuts(pauses, captions), [pauses, captions]);
  const hasAuto = draft.cuts.some(cut => cut.auto);
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-slate-800 p-3">
      <Check
        checked={hasAuto} disabled={!auto.length && !hasAuto} label={t.editAudio.shortenPauses}
        help={auto.length ? t.editAudio.shortenPausesHelp(auto.length) : t.editAudio.noSilence}
        onChange={on => onDraft(withAutoCuts(draft, on ? auto : [], duration))}
      />
      <label className="flex flex-col gap-1">
        <span className="flex items-center justify-between">
          <span className="font-semibold text-slate-100">{t.editAudio.speed}</span>
          <span className="font-mono text-xs text-slate-300" dir="ltr">{draft.tempo.toFixed(2)}×</span>
        </span>
        <input type="range" min={1} max={MAX_TEMPO} step={0.01} value={draft.tempo} dir="ltr" onChange={e => onDraft({ ...draft, tempo: Number(e.target.value) })} />
        <span className="text-xs text-slate-400 leading-relaxed">{t.editAudio.speedHelp}</span>
      </label>
    </section>
  );
};

/** Fit to a length, and the clean-ups. */
const FitAndCleanUp: React.FC<PlanProps & { isUpload: boolean }> = ({ draft, duration, pauses, captions, isUpload, onDraft }) => {
  const t = useT();
  const [target, setTarget] = useState(60);
  const [fit, setFit] = useState<FitResult | null>(null);
  const runFit = () => {
    const result = fitToLength({ target, duration, edit: draft, auto: pauseCuts(pauses, captions), verses: captions });
    onDraft(result.edit);
    setFit(result);
  };
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-slate-800 p-3">
      <span className="font-semibold text-slate-100">{t.editAudio.fitTitle}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {TARGETS.map(seconds => (
          <button key={seconds} onClick={() => setTarget(seconds)} className={target === seconds ? BUTTON_STRONG : BUTTON}>{seconds}s</button>
        ))}
        <input
          type="number" min={5} max={3600} value={target} dir="ltr" aria-label={t.editAudio.fitSeconds}
          onChange={e => setTarget(Math.max(5, Number(e.target.value) || 60))}
          className="w-20 px-2 py-1 rounded-md bg-slate-950 border border-slate-700 font-mono text-xs"
        />
        <button onClick={runFit} className={BUTTON_STRONG}>{t.editAudio.fit}</button>
      </div>
      {/* Said only while the edit is still the one fitting made. */}
      {fit && encodeEdit(fit.edit) === encodeEdit(draft) && <FitOutcome fit={fit} duration={duration} captions={captions} draft={draft} onDraft={onDraft} />}
      <Check checked={draft.loudness} label={t.editAudio.loudness} help={t.editAudio.loudnessHelp} onChange={on => onDraft({ ...draft, loudness: on })} />
      <Check checked={draft.loop} label={t.editAudio.loop} help={t.editAudio.loopHelp} onChange={on => onDraft({ ...draft, loop: on })} />
      {isUpload && <Check checked={draft.denoise} label={t.editAudio.denoise} help={t.editAudio.denoiseHelp} onChange={on => onDraft({ ...draft, denoise: on })} />}
    </section>
  );
};

/** What fitting came to: the length and speed, or how far over and which ayahs would fit. */
const FitOutcome: React.FC<PanelProps & { fit: FitResult; captions: VerseData[] }> = ({ fit, duration, captions, draft, onDraft }) => {
  const t = useT();
  const drop = fit.drop.join(', ');
  const leaveOut = () => {
    const from = Math.min(...captions.filter(caption => fit.drop.includes(caption.verseKey)).map(caption => caption.startTime));
    onDraft(withCuts(draft, [{ start: from, end: duration }], duration));
  };
  if (fit.over <= 0) {
    return <p className="text-xs leading-relaxed text-slate-300">{t.editAudio.fitDone(formatDuration(editedLength(fit.edit, duration)), fit.edit.tempo.toFixed(2))}</p>;
  }
  return (
    <p className="text-xs leading-relaxed text-slate-300">
      {t.editAudio.fitOver(fit.over.toFixed(1), drop)}
      {drop && <button onClick={leaveOut} className="ms-2 underline text-amber-300">{t.editAudio.dropAyahs(drop)}</button>}
    </p>
  );
};

/** The one-click cuts: to the voice, the openings, and back to the recording as it was. */
const QuickCuts: React.FC<PanelProps & { captions: VerseData[]; voice: Span | null; onReset: () => void }> = ({
  draft, duration, captions, voice, onDraft, onReset,
}) => {
  const t = useT();
  const opening = useMemo(() => openingCut(captions), [captions]);
  return (
    <div className="flex flex-wrap gap-2">
      {voice && (
        <button onClick={() => onDraft(withCuts(draft, [{ start: 0, end: voice.start }, { start: voice.end, end: duration }], duration))} className={BUTTON}>
          {t.editAudio.trimToVoice}
        </button>
      )}
      {opening && <button onClick={() => onDraft(withCuts(draft, [opening], duration))} className={BUTTON}>{t.editAudio.removeOpenings}</button>}
      <button onClick={onReset} className={BUTTON}><RotateCcw className="w-3.5 h-3.5" />{t.editAudio.resetAll}</button>
    </div>
  );
};

const Check: React.FC<{ checked: boolean; disabled?: boolean; label: string; help: string; onChange: (on: boolean) => void }> = ({
  checked, disabled = false, label, help, onChange,
}) => (
  <label className="flex items-start gap-2">
    <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} className="mt-0.5" />
    <span>
      <span className="font-semibold text-slate-100">{label}</span>
      <span className="block text-xs text-slate-400 leading-relaxed">{help}</span>
    </span>
  </label>
);
