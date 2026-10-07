'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, Monitor, Share2, Upload } from 'lucide-react';
import type { PublishMetadata } from '@/lib/publishMetadata';
import { postTargets, postText, renderedFor, shareableFile, UPLOAD_PAGES, type Platform } from '@/lib/postTargets';
import { youtubeClientId } from '@/lib/youtubeUpload';
import { YouTubeUpload, type UnsentUpload } from './YouTubeUpload';
import { useT } from './LocaleProvider';

interface PostPanelProps {
  /** The finished render. */
  blob: Blob;
  fileName: string;
  /** The export presets it was rendered for, so their platform comes first. */
  presetIds: string[];
  /** The caption, built when it is needed: it may fetch the translation catalogue. */
  caption: () => Promise<PublishMetadata>;
  /** The "This computer" row's buttons, which the result screen owns. */
  download: React.ReactNode;
  /** Whether a YouTube upload is set up and not yet sent -- see `YouTubeUpload`. */
  onYouTubeUnsent?: (pending: UnsentUpload) => void;
}

type Status = { tone: 'ok' | 'warn'; text: string } | null;

/** The caption on the clipboard; false when the browser would not allow it. */
async function copyCaption(meta: PublishMetadata): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(postText(meta));
    return true;
  } catch {
    return false;
  }
}

/** What the list's buttons do, and what they last said about it. */
function usePosting({ blob, fileName, caption }: Pick<PostPanelProps, 'blob' | 'fileName' | 'caption'>) {
  const t = useT();
  const [status, setStatus] = useState<Status>(null);

  const file = useMemo(
    () => shareableFile(blob, fileName, typeof navigator !== 'undefined' && navigator.canShare ? data => navigator.canShare(data) : undefined),
    [blob, fileName]
  );

  const share = async () => {
    if (!file) return;
    const meta = await caption();
    // Some apps take the video and drop the text, so it is on the clipboard
    // as well, ready to paste into the app's own caption field.
    const copied = await copyCaption(meta);
    try {
      await navigator.share({ files: [file], title: meta.title, text: postText(meta) });
      setStatus({ tone: 'ok', text: copied ? t.post.sharedCopied : t.post.shared });
    } catch (err) {
      // Closing the share sheet is a choice, not a failure.
      setStatus((err as Error)?.name === 'AbortError' ? null : { tone: 'warn', text: t.post.shareFailed });
    }
  };

  const open = async (platform: Platform) => {
    // Opened before anything is awaited: a browser only lets a click open a
    // tab while the click is still the thing happening. Not `noopener` in the
    // features: with it the call returns null whether or not the tab opened,
    // and a blocked pop-up could not be told apart.
    const tab = window.open(UPLOAD_PAGES[platform], '_blank');
    if (tab) tab.opener = null;
    const copied = await copyCaption(await caption());
    const name = t.post.platforms[platform];
    if (!tab) return setStatus({ tone: 'warn', text: t.post.popupBlocked(name) });
    setStatus({ tone: copied ? 'ok' : 'warn', text: copied ? t.post.openedCopied(name) : t.post.openedNotCopied(name) });
  };

  return { file, status, share, open };
}

const ROW = 'rounded-xl border bg-slate-950/60';
const ROW_HEAD = 'w-full flex items-center gap-3 px-3 py-3 text-start text-slate-100 hover:bg-slate-800/40 rounded-xl transition-colors';

/** One destination: a heading row, and what opens under it when it is the open one. */
const Destination: React.FC<{
  icon: React.ReactNode; title: string; help: string; highlight?: boolean;
  open?: boolean; onToggle?: () => void; onPress?: () => void; children?: React.ReactNode;
}> = ({ icon, title, help, highlight, open, onToggle, onPress, children }) => (
  <li className={`${ROW} ${open || highlight ? 'border-emerald-500/50' : 'border-slate-800'}`}>
    <button onClick={onToggle ?? onPress} aria-expanded={onToggle ? open : undefined} className={ROW_HEAD}>
      <span className="shrink-0 text-slate-300">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">{title}</span>
        <span className="block text-[11px] text-slate-400">{help}</span>
      </span>
      {onToggle
        ? <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        : <ExternalLink className="w-4 h-4 text-slate-400" />}
    </button>
    {open && children && <div className="px-3 pb-3 flex flex-col gap-2">{children}</div>}
  </li>
);

/**
 * Where the clip goes next: this computer, then each platform, the one it was
 * rendered for first, and only one row open at a time. The person signs in to
 * the platform, never to the studio -- see `postTargets`.
 */
export const PostPanel: React.FC<PostPanelProps> = ({ blob, fileName, presetIds, caption, download, onYouTubeUnsent }) => {
  const t = useT();
  const { file, status, share, open } = usePosting({ blob, fileName, caption });
  const clientId = youtubeClientId();
  const [expanded, setExpanded] = useState<'computer' | 'youtube' | null>(
    clientId && renderedFor('youtube', presetIds) ? 'youtube' : 'computer'
  );
  const toggle = (row: 'computer' | 'youtube') => setExpanded(current => (current === row ? null : row));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t.post.sendTo}</p>
      <ul className="flex flex-col gap-2">
        <Destination icon={<Monitor className="w-5 h-5" />} title={t.post.computer} help={t.post.computerHelp}
          open={expanded === 'computer'} onToggle={() => toggle('computer')}>
          {download}
        </Destination>
        {postTargets(presetIds).map(platform => platform === 'youtube' && clientId ? (
          <Destination key={platform} icon={<Upload className="w-5 h-5" />} title={t.post.platforms.youtube} help={t.post.uploadsHelp}
            highlight={renderedFor(platform, presetIds)} open={expanded === 'youtube'} onToggle={() => toggle('youtube')}>
            <YouTubeUpload clientId={clientId} blob={blob} caption={caption} onUnsent={onYouTubeUnsent} />
            <button onClick={() => open('youtube')} className="self-start text-[11px] text-slate-400 hover:text-emerald-300 underline">
              {t.post.youtubePage}
            </button>
          </Destination>
        ) : (
          <Destination key={platform} icon={<ExternalLink className="w-5 h-5" />} title={t.post.platforms[platform]} help={t.post.openHelp}
            highlight={renderedFor(platform, presetIds)} onPress={() => open(platform)} />
        ))}
        {file && (
          <Destination icon={<Share2 className="w-5 h-5" />} title={t.post.share} help={t.post.shareHelp} onPress={share} />
        )}
      </ul>
      {status && (
        <p role="status" className={`text-[11px] leading-relaxed ${status.tone === 'ok' ? 'text-emerald-300' : 'text-amber-300/90'}`}>
          {status.text}
        </p>
      )}
    </div>
  );
};
