'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Upload, ExternalLink } from 'lucide-react';
import type { PublishMetadata } from '@/lib/publishMetadata';
import {
  sendVideo, startUpload, studioLink, watchLink, UploadError, YOUTUBE_UPLOAD_SCOPE,
  type Privacy, type UploadFailure
} from '@/lib/youtubeUpload';
import { forgetToken, heldToken, loadGoogleSignIn, requestToken } from '@/lib/googleSignIn';
import { useT } from './LocaleProvider';

interface YouTubeUploadProps {
  clientId: string;
  blob: Blob;
  caption: () => Promise<PublishMetadata>;
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'signing' }
  | { kind: 'uploading'; progress: number }
  | { kind: 'done'; id: string }
  | { kind: 'failed'; failure: UploadFailure | 'cancelled' };

/** Signing in, uploading and what happened, for one render. */
function useYouTubeUpload({ clientId, blob, caption }: YouTubeUploadProps) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);

  // Google's script is fetched when the panel appears, so the click can open
  // the sign-in pop-up at once -- see `googleSignIn`.
  useEffect(() => { void loadGoogleSignIn(); }, []);
  useEffect(() => () => abort.current?.abort(), []);

  const upload = async (privacy: Privacy) => {
    // No await before this: the pop-up has to open inside the click.
    const tokenOrSignIn = heldToken() ?? requestToken(clientId, YOUTUBE_UPLOAD_SCOPE);
    setStage({ kind: 'signing' });
    try {
      const token = await tokenOrSignIn;
      setStage({ kind: 'uploading', progress: 0 });
      const meta = await caption();
      const location = await startUpload(token, meta, privacy, blob);
      abort.current = new AbortController();
      const { id } = await sendVideo(location, blob, progress => setStage({ kind: 'uploading', progress }), abort.current.signal);
      setStage({ kind: 'done', id });
    } catch (err) {
      if (err instanceof UploadError) {
        if (err.failure === 'signin') forgetToken();
        setStage({ kind: 'failed', failure: err.failure });
      } else {
        // The pop-up closed, consent refused, or the upload cancelled.
        setStage({ kind: 'failed', failure: (err as Error)?.name === 'AbortError' ? 'cancelled' : 'signin' });
      }
    }
  };

  return { stage, upload, cancel: () => abort.current?.abort() };
}

/** What happened, once something has. */
const StageNote: React.FC<{ stage: Stage; onCancel: () => void }> = ({ stage, onCancel }) => {
  const t = useT();
  if (stage.kind === 'signing') return <p className="text-[11px] text-slate-300">{t.youtube.signingIn}</p>;
  if (stage.kind === 'uploading') {
    const percent = Math.round(stage.progress * 100);
    return (
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-slate-800" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-emerald-400 transition-[width]" style={{ width: `${percent}%` }} />
        </div>
        <span className="text-[11px] font-mono text-slate-300">{percent}%</span>
        <button onClick={onCancel} className="text-[11px] text-slate-400 hover:text-slate-200">{t.youtube.cancel}</button>
      </div>
    );
  }
  if (stage.kind === 'done') {
    return (
      <p role="status" className="text-[11px] leading-relaxed text-emerald-300">
        {t.youtube.done}{' '}
        <a href={studioLink(stage.id)} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">
          {t.youtube.openStudio}<ExternalLink className="w-3 h-3" />
        </a>{' · '}
        <a href={watchLink(stage.id)} target="_blank" rel="noopener noreferrer" className="underline">{watchLink(stage.id)}</a>
      </p>
    );
  }
  if (stage.kind === 'failed') return <p role="status" className="text-[11px] leading-relaxed text-amber-300/90">{t.youtube.failed[stage.failure]}</p>;
  return null;
};

/**
 * Uploads the render to the user's YouTube channel, signed in to Google in a
 * pop-up -- see `youtubeUpload`. Only shown when the studio has a Google
 * client id to sign in with.
 */
export const YouTubeUpload: React.FC<YouTubeUploadProps> = props => {
  const t = useT();
  const [privacy, setPrivacy] = useState<Privacy>('private');
  const { stage, upload, cancel } = useYouTubeUpload(props);
  const busy = stage.kind === 'signing' || stage.kind === 'uploading';

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
      <div className="flex items-center gap-2">
        <button
          onClick={() => upload(privacy)}
          disabled={busy}
          className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {t.youtube.upload}
        </button>
        <select
          value={privacy}
          onChange={e => setPrivacy(e.target.value as Privacy)}
          disabled={busy}
          aria-label={t.youtube.privacyLabel}
          className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200"
        >
          {(['private', 'unlisted', 'public'] as const).map(p => <option key={p} value={p}>{t.youtube.privacy[p]}</option>)}
        </select>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-400">{t.youtube.help}</p>
      <StageNote stage={stage} onCancel={cancel} />
    </div>
  );
};
