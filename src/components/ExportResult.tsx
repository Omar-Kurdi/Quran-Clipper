'use client';

import React from 'react';
import { AlertTriangle, CheckCircle, Download, Film, Loader2 } from 'lucide-react';
import type { ExportVerdict } from '@/lib/exportHealth';
import type { PublishInput, PublishMetadata } from '@/lib/publishMetadata';
import type { RenderCheckInput } from '@/lib/renderCheckRunner';
import { formatBytes } from '@/lib/exportPresets';
import { RenderCheckPanel } from './RenderCheckPanel';
import { PublishCaption } from './PublishCaption';
import { PostPanel } from './PostPanel';
import type { UnsentUpload } from './YouTubeUpload';
import { StudioVideo } from './StudioVideo';
import { useT } from './LocaleProvider';

export interface ExportResultProps {
  blob: Blob;
  blobUrl: string;
  fileName: string;
  renderedMs: number;
  gpuName: string;
  verdict: ExportVerdict;
  starvedSeconds: number;
  pauses: number;
  renderCheck: RenderCheckInput;
  publish: Omit<PublishInput, 'includeVerseText' | 'translationNames'>;
  translationIds: string[];
  captionIncludesText: boolean;
  onCaptionIncludesText: (include: boolean) => void;
  /** The export presets this file was rendered for. */
  presetIds: string[];
  caption: () => Promise<PublishMetadata>;
  savingCaption: boolean;
  onDownloadWithCaption: () => void;
  onRenderAnother: () => void;
  onDone: () => void;
  onYouTubeUnsent?: (pending: UnsentUpload) => void;
}

/** What the render produced, and whether it is watchable, in one compact row. */
const ResultHeader: React.FC<Pick<ExportResultProps, 'blob' | 'blobUrl' | 'fileName' | 'renderedMs' | 'gpuName' | 'verdict'>> = ({
  blob, blobUrl, fileName, renderedMs, gpuName, verdict
}) => {
  const t = useT();
  const clean = verdict === 'clean';
  return (
    <div className="flex gap-3 items-center">
      {/* `preload="none"`: this mounts while the encoder's buffers and the
          file are all still in memory, and decoding a 4K file on top of them
          is what crashed the tab. It still plays when asked. */}
      <div className="w-20 h-36 shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-black">
        <StudioVideo src={blobUrl} controls preload="none" className="w-full h-full object-contain" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`flex items-center gap-1.5 text-xs font-semibold ${clean ? 'text-emerald-300' : 'text-amber-300'}`}>
          {clean ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
          {t.exportModal.complete}
        </p>
        <h4 className="mt-1 truncate text-base font-bold text-slate-100" dir="ltr">{fileName}</h4>
        <p className="mt-1 text-[11px] text-slate-400">
          <span className="font-mono" dir="ltr">{formatBytes(blob.size)}</span>
          {' · '}{t.exportModal.renderedIn}{' '}
          <span className="font-mono" dir="ltr">{Math.round(renderedMs / 100) / 10}s</span>
          {t.exportModal.renderedOn(gpuName)}
        </p>
      </div>
    </div>
  );
};

/** Faults the file carries that it gives no sign of itself -- see `exportHealth`. */
const HealthNotes: React.FC<Pick<ExportResultProps, 'verdict' | 'starvedSeconds' | 'pauses'>> = ({ verdict, starvedSeconds, pauses }) => {
  const t = useT();
  return (
    <>
      {pauses > 0 && (
        <p className="text-[11px] leading-relaxed text-slate-300 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2">
          {t.exportModal.pausedNotice(pauses)}
        </p>
      )}
      {verdict !== 'clean' && (
        <p className="text-[11px] leading-relaxed text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          {verdict === 'frozen' ? t.exportModal.frozenWarning(Math.round(starvedSeconds)) : t.exportModal.choppyWarning}
        </p>
      )}
    </>
  );
};

/** The "This computer" destination's own buttons: the file, or the file and its caption. */
const DownloadActions: React.FC<Pick<ExportResultProps, 'blobUrl' | 'fileName' | 'savingCaption' | 'onDownloadWithCaption'>> = ({
  blobUrl, fileName, savingCaption, onDownloadWithCaption
}) => {
  const t = useT();
  const container = fileName.endsWith('.mp4') ? 'MP4' : 'WebM';
  return (
    <div className="flex flex-wrap gap-2">
      <a
        href={blobUrl}
        download={fileName}
        className="flex-1 min-w-[10rem] py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
      >
        <Download className="w-4 h-4" />
        {t.exportModal.download(container)}
      </a>
      <button
        onClick={onDownloadWithCaption}
        disabled={savingCaption}
        className="flex-1 min-w-[10rem] py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-emerald-300 text-xs font-bold rounded-lg border border-emerald-500/40 flex items-center justify-center gap-2 transition-colors"
      >
        {savingCaption ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {t.exportModal.downloadWithCaption(container)}
      </button>
    </div>
  );
};

/**
 * The finished render: what it is, its caption, and where it goes next.
 *
 * Laid out as one list of destinations -- this computer, then each platform --
 * with only one open at a time, and the caption as a collapsed box above it.
 * The screen used to stack every one of these at full height, and with the
 * ayah text in the caption it ran several screens long.
 */
export const ExportResult: React.FC<ExportResultProps> = props => {
  const t = useT();
  return (
    <div className="flex flex-col gap-3 py-1 text-start animate-fade-in">
      <ResultHeader {...props} />
      <HealthNotes {...props} />
      <RenderCheckPanel key={props.blobUrl} url={props.blobUrl} blob={props.blob} input={props.renderCheck} />
      <PublishCaption
        publish={props.publish}
        translationIds={props.translationIds}
        includeVerseText={props.captionIncludesText}
        onIncludeVerseText={props.onCaptionIncludesText}
      />
      <PostPanel
        blob={props.blob}
        fileName={props.fileName}
        presetIds={props.presetIds}
        caption={props.caption}
        download={<DownloadActions {...props} />}
        onYouTubeUnsent={props.onYouTubeUnsent}
      />
      <div className="mt-1 flex items-center justify-between border-t border-slate-800 pt-3">
        <button
          onClick={props.onRenderAnother}
          className="py-2 px-3 bg-transparent hover:bg-slate-800 text-slate-300 text-xs font-bold rounded-lg border border-slate-700 transition-colors flex items-center gap-1.5"
        >
          <Film className="w-3.5 h-3.5 text-amber-400" />
          {t.exportModal.renderAnother}
        </button>
        <button onClick={props.onDone} className="py-2 px-4 bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs font-bold rounded-lg transition-colors">
          {t.exportModal.done}
        </button>
      </div>
    </div>
  );
};
