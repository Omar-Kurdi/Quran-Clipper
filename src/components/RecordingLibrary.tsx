'use client';

import React from 'react';
import { Check, HardDrive, Mic, Plus, Trash2 } from 'lucide-react';
import { clipColour } from '@/lib/clipColours';
import { libraryOf, type ExportedClip, type LibraryClip, type LibraryProject, type LibraryRecording } from '@/lib/projectLibrary';
import { projectLength } from '@/lib/projectSearch';
import { formatStamp } from '@/lib/stamp';
import { useLocale, useT } from './LocaleProvider';

export interface OpenRequest {
  project: LibraryProject;
  /** The clip to open, or null for the whole recording. */
  clipId: string | null;
  /** Open ready to choose the next clip's stretch. */
  newClip?: boolean;
}

interface RecordingLibraryProps {
  projects: LibraryProject[];
  done: ExportedClip[];
  onOpen: (request: OpenRequest) => void;
  onRemove: (recording: LibraryRecording) => void;
  removing: string | null;
}

const ayahRange = (clip: Pick<LibraryClip, 'surahNumber' | 'first' | 'last'>) =>
  !clip.first ? '' : clip.first === clip.last ? `${clip.surahNumber}:${clip.first}` : `${clip.surahNumber}:${clip.first}–${clip.last}`;

/** When a clip was made and last exported, the year left out on the card and given in full on hover. */
const ClipDates: React.FC<{ clip: LibraryClip }> = ({ clip }) => {
  const t = useT();
  const { locale } = useLocale();
  return (
    <span className="mt-0.5 block font-sans text-[10px] leading-snug text-slate-400"
      title={[t.library.made(formatStamp(clip.madeAt, locale)), clip.exportedAt ? t.library.exportedOn(formatStamp(clip.exportedAt, locale)) : '']
        .filter(Boolean).join('\n')}>
      <span className="block whitespace-nowrap">{t.library.made(formatStamp(clip.madeAt, locale, true))}</span>
      {clip.exportedAt && <span className="block whitespace-nowrap text-emerald-300/80">{t.library.exportedOn(formatStamp(clip.exportedAt, locale, true))}</span>}
    </span>
  );
};

/** A clip as a small 9:16 card: its surah, its ayahs, when it was made and exported, and a tick once exported. */
const ClipCard: React.FC<{
  clip: LibraryClip; surahArabic: string; caption?: string; size: 'large' | 'small'; onOpen: () => void;
}> = ({ clip, surahArabic, caption, size, onOpen }) => {
  const t = useT();
  const large = size === 'large';
  return (
    <button type="button" onClick={onOpen} className={`group shrink-0 text-start w-28 focus-visible:outline-none`}
      title={t.clips.openTitle(t.clips.name(clip.number))}>
      <span className={`relative block ${large ? 'h-[170px]' : 'h-[112px]'} rounded-lg border-2 overflow-hidden bg-[radial-gradient(120%_70%_at_50%_110%,#123247,#08162a_55%,#050b18)] transition-transform group-hover:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-amber-400 ${
        clip.exported ? 'border-emerald-400' : 'border-dashed border-slate-600 opacity-80'
      }`}>
        <span className={`absolute inset-x-1 ${large ? 'top-14 text-base' : 'top-9 text-xs'} text-center font-display text-slate-100`} dir="rtl">{surahArabic}</span>
        <span className={`absolute inset-x-2 ${large ? 'top-[88px]' : 'top-[60px]'} h-0.5 rounded bg-slate-300/50`} />
        <span className={`absolute ${large ? 'inset-x-5 top-[96px]' : 'inset-x-3.5 top-[66px]'} h-0.5 rounded bg-slate-300/30`} />
        <span className={`absolute top-1.5 start-1.5 w-2 h-2 rounded-sm ${clipColour(clip.number - 1).dot}`} />
        {clip.exported && <Check className="absolute top-1 end-1 w-3.5 h-3.5 text-emerald-400" aria-label={t.clips.exported} />}
      </span>
      <span className={`mt-1 block font-semibold text-slate-100 ${large ? 'text-xs' : 'text-[11px]'}`}>{t.clips.name(clip.number)}</span>
      <span className="block font-mono text-[10px] text-gold" dir="ltr">{ayahRange(clip)}</span>
      {caption && <span className="block text-[10px] text-slate-400 truncate">{caption}</span>}
      <ClipDates clip={clip} />
    </button>
  );
};

/** Which ayahs of the surah are in a clip: a cell per ayah, in its first clip's colour. */
const SurahCoverage: React.FC<{ recording: LibraryRecording }> = ({ recording }) => {
  const t = useT();
  const total = recording.coverage.length;
  if (!total) return null;
  const clipped = recording.coverage.filter(cell => cell.length > 0).length;
  const s = recording.surahNumber;
  return (
    <div className="max-w-2xl">
      <div className="flex h-3 rounded overflow-hidden border border-slate-800 bg-slate-900" dir="ltr" role="img" aria-label={t.clips.coverage(clipped, total)}>
        {recording.coverage.map((cell, i) => (
          <span key={i} title={`${s}:${i + 1}${cell.length ? ` · ${cell.map(n => t.clips.name(n)).join(', ')}` : ''}`}
            className={`flex-1 ${cell.length ? clipColour(cell[0] - 1).dot : ''}`} />
        ))}
      </div>
      <div className="mt-1 flex justify-between gap-2 font-mono text-[10px] text-slate-400" dir="ltr">
        <span>{s}:1</span>
        <span className="font-sans text-slate-300">{t.clips.coverage(clipped, total)}</span>
        <span>{s}:{total}</span>
      </div>
    </div>
  );
};

/** A recording's name, its file or reciter and folder, where it is from, when, and how many of its clips are exported. */
const RecordingHead: React.FC<{ recording: LibraryRecording }> = ({ recording }) => {
  const t = useT();
  const { locale } = useLocale();
  const exported = recording.clips.filter(clip => clip.exported).length;
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[15px] font-semibold text-slate-100">{recording.surahNameEnglish}</span>
        {recording.artist && <span className="text-[13px] font-semibold text-amber-300" dir="auto" title={t.library.artistTitle}>{recording.artist}</span>}
        {recording.folder && <span className="font-mono text-xs text-slate-300 truncate" dir="auto" title={t.library.folderTitle}>{recording.folder}/</span>}
        {recording.source &&<span className="font-mono text-xs text-slate-400 truncate" dir="auto">{recording.source}</span>}
      </div>
      <div className="flex flex-wrap gap-x-3 font-mono text-[11px] text-slate-400">
        <span>{t.library.created(formatStamp(recording.createdAt, locale))}</span>
        {recording.updatedAt !== recording.createdAt && <span>{t.library.edited(formatStamp(recording.updatedAt, locale))}</span>}
      </div>
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-slate-700 text-slate-300">
          {recording.kind === 'upload' ? <HardDrive className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
          {recording.kind === 'upload' ? t.library.yourRecording : t.library.builtInReciter}
        </span>
        {exported > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-emerald-500/40 text-emerald-300">
            <Check className="w-3 h-3" />{t.library.exportedCount(exported)}
          </span>
        )}
      </div>
    </>
  );
};

/** One recording: what it is, which ayahs are clipped, its clips, and opening it. */
const RecordingRow: React.FC<{
  recording: LibraryRecording; removing: boolean; onOpen: RecordingLibraryProps['onOpen']; onRemove: () => void;
}> = ({ recording, removing, onOpen, onRemove }) => {
  const t = useT();
  const length = projectLength(recording.duration);
  const projectOf = (clip: LibraryClip) => recording.projects.find(p => p.id === clip.projectId) ?? recording.project;
  return (
    <li className="grid grid-cols-1 md:grid-cols-[9rem_minmax(0,1fr)_auto] gap-4 py-4 border-t border-slate-800">
      <div className="hidden md:flex flex-col justify-between h-24 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5">
        <span className="font-display text-lg text-amber-300" dir="rtl">{recording.surahNameArabic}</span>
        <span className="font-mono text-[11px] text-slate-400" dir="ltr">{length ?? ''}</span>
      </div>
      <div className="min-w-0 flex flex-col gap-2">
        <RecordingHead recording={recording} />
        <SurahCoverage recording={recording} />
        <div className="flex gap-2.5 overflow-x-auto pb-1">
          {recording.clips.map(clip => (
            <ClipCard key={`${clip.projectId}:${clip.clipId}`} clip={clip} surahArabic={recording.surahNameArabic} size="small"
              onOpen={() => onOpen({ project: projectOf(clip), clipId: clip.clipId })} />
          ))}
          <button type="button" onClick={() => onOpen({ project: recording.project, clipId: null, newClip: true })}
            className="shrink-0 w-24 text-start focus-visible:outline-none group">
            <span className="flex items-center justify-center h-[112px] rounded-lg border-2 border-dashed border-slate-600 text-amber-400 group-hover:border-amber-500 group-focus-visible:ring-2 group-focus-visible:ring-amber-400">
              <Plus className="w-5 h-5" />
            </span>
            <span className="mt-1 block text-[11px] font-semibold text-amber-400">{t.clips.newTab}</span>
          </button>
        </div>
      </div>
      <div className="flex md:flex-col gap-2 md:w-32">
        <button type="button" onClick={() => onOpen({ project: recording.project, clipId: null })}
          className="h-9 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[13px] font-bold">
          {t.library.open}
        </button>
        <button type="button" onClick={onRemove} disabled={removing}
          className="h-9 px-3 rounded-lg border border-slate-700 text-[12px] font-semibold text-slate-400 hover:text-red-300 hover:border-red-500/40 inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
          <Trash2 className="w-3.5 h-3.5" />{t.library.remove}
        </button>
      </div>
    </li>
  );
};

/**
 * Projects as a library of recordings (`projectLibrary.ts`): the latest clips
 * first, after Video-Clipper's shorts, then each recording once with every
 * clip made from it and which ayahs of its surah are clipped already -- so a
 * long recording on this computer is opened again, not uploaded and cut again.
 */
export const RecordingLibrary: React.FC<RecordingLibraryProps> = ({ projects, done, onOpen, onRemove, removing }) => {
  const t = useT();
  const { recordings, latestClips } = libraryOf(projects, done);
  return (
    <div className="flex flex-col gap-6">
      {latestClips.length > 0 && (
        <section aria-label={t.library.latest}>
          <h4 className="font-display text-2xl text-slate-100 mb-3">{t.library.latest}</h4>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {latestClips.slice(0, 10).map(clip => (
              <ClipCard key={`${clip.projectId}:${clip.clipId}`} clip={clip} surahArabic={clip.recording.surahNameArabic} size="large"
                caption={clip.recording.surahNameEnglish}
                onOpen={() => onOpen({ project: clip.recording.projects.find(p => p.id === clip.projectId) ?? clip.recording.project, clipId: clip.clipId })} />
            ))}
          </div>
        </section>
      )}
      <section aria-label={t.library.recordings}>
        <h4 className="font-display text-2xl text-slate-100">{t.library.recordings}</h4>
        <p className="mt-0.5 mb-2 text-xs text-slate-400">{t.library.recordingsNote}</p>
        <ul>
          {recordings.map(recording => (
            <RecordingRow key={recording.key} recording={recording} removing={removing === recording.key}
              onOpen={onOpen} onRemove={() => onRemove(recording)} />
          ))}
        </ul>
      </section>
    </div>
  );
};
