'use client';

import React, { useMemo, useState } from 'react';
import { ExternalLink, Share2 } from 'lucide-react';
import type { PublishMetadata } from '@/lib/publishMetadata';
import { postTargets, postText, renderedFor, shareableFile, UPLOAD_PAGES, type Platform } from '@/lib/postTargets';
import { youtubeClientId } from '@/lib/youtubeUpload';
import { YouTubeUpload } from './YouTubeUpload';
import { useT } from './LocaleProvider';

interface PostPanelProps {
  /** The finished render. */
  blob: Blob;
  fileName: string;
  /** The export presets it was rendered for, so their platform comes first. */
  presetIds: string[];
  /** The caption, built when it is needed: it may fetch the translation catalogue. */
  caption: () => Promise<PublishMetadata>;
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

/** What the panel's buttons do, and what they last said about it. */
function usePosting({ blob, fileName, caption }: Omit<PostPanelProps, 'presetIds'>) {
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

/** One button per platform, those the clip was rendered for marked. */
const PlatformButtons: React.FC<{ presetIds: string[]; onOpen: (platform: Platform) => void }> = ({ presetIds, onOpen }) => {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-2">
      {postTargets(presetIds).map(platform => (
        <button
          key={platform}
          onClick={() => onOpen(platform)}
          title={t.post.openTitle(t.post.platforms[platform])}
          className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
            renderedFor(platform, presetIds)
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
              : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          {t.post.platforms[platform]}
        </button>
      ))}
    </div>
  );
};

/**
 * Posting the clip, with the person signed in to the platform rather than to
 * the studio -- see `postTargets`.
 *
 * The share button only appears where the browser can share a file, which is
 * mostly phones; everywhere, each platform's upload page opens with the
 * caption already on the clipboard.
 */
export const PostPanel: React.FC<PostPanelProps> = ({ blob, fileName, presetIds, caption }) => {
  const t = useT();
  const { file, status, share, open } = usePosting({ blob, fileName, caption });

  return (
    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 flex flex-col gap-2.5">
      <div>
        <p className="text-xs font-semibold text-slate-200">{t.post.title}</p>
        <p className="text-[11px] leading-relaxed text-slate-400">{t.post.help}</p>
      </div>

      {file && (
        <button
          onClick={share}
          className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl flex items-center justify-center gap-2 transition-colors"
        >
          <Share2 className="w-4 h-4" />
          <span>{t.post.share}</span>
        </button>
      )}

      {youtubeClientId() && <YouTubeUpload clientId={youtubeClientId()} blob={blob} caption={caption} />}

      <PlatformButtons presetIds={presetIds} onOpen={open} />

      {status && (
        <p role="status" className={`text-[11px] leading-relaxed ${status.tone === 'ok' ? 'text-emerald-300' : 'text-amber-300/90'}`}>
          {status.text}
        </p>
      )}
    </div>
  );
};
