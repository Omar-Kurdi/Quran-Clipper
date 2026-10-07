'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Upload, ExternalLink } from 'lucide-react';
import type { PublishMetadata } from '@/lib/publishMetadata';
import {
  defaultScheduleValue, scheduleTime, sendVideo, startUpload, studioLink, watchLink, UploadError, YOUTUBE_UPLOAD_SCOPE,
  type Privacy, type UploadFailure
} from '@/lib/youtubeUpload';
import { forgetToken, heldToken, loadGoogleSignIn, requestToken } from '@/lib/googleSignIn';
import { useStudioConfig } from '@/hooks/useStudioConfig';
import { useT } from './LocaleProvider';

interface YouTubeUploadProps {
  clientId: string;
  blob: Blob;
  caption: () => Promise<PublishMetadata>;
  /**
   * Told whether closing now would lose an upload: one set up and not sent,
   * or still on its way. The export dialog asks before closing over one.
   */
  onUnsent?: (pending: UnsentUpload) => void;
}

/** An upload closing the dialog would lose: set up and not sent, or on its way; null for none. */
export type UnsentUpload = 'unsent' | 'uploading' | null;

/** The hour a personal studio schedules its uploads for by default. */
const PERSONAL_SCHEDULE_HOUR = 18;

type Stage =
  | { kind: 'idle' }
  | { kind: 'signing' }
  | { kind: 'uploading'; progress: number }
  | { kind: 'done'; id: string; publishAt?: string }
  | { kind: 'failed'; failure: UploadFailure | 'cancelled' };

/** Signing in, uploading and what happened, for one render. */
function useYouTubeUpload({ clientId, blob, caption }: YouTubeUploadProps) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);

  // Google's script is fetched when the panel appears, so the click can open
  // the sign-in pop-up at once -- see `googleSignIn`.
  useEffect(() => { void loadGoogleSignIn(); }, []);
  useEffect(() => () => abort.current?.abort(), []);

  const upload = async (privacy: Privacy, publishAt?: string) => {
    // No await before this: the pop-up has to open inside the click.
    const tokenOrSignIn = heldToken() ?? requestToken(clientId, YOUTUBE_UPLOAD_SCOPE);
    setStage({ kind: 'signing' });
    try {
      const token = await tokenOrSignIn;
      setStage({ kind: 'uploading', progress: 0 });
      const meta = await caption();
      const location = await startUpload(token, meta, privacy, blob, publishAt);
      abort.current = new AbortController();
      const { id } = await sendVideo(location, blob, progress => setStage({ kind: 'uploading', progress }), abort.current.signal);
      setStage({ kind: 'done', id, publishAt });
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
        {stage.publishAt ? t.youtube.doneScheduled(new Date(stage.publishAt).toLocaleString()) : t.youtube.done}{' '}
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

/** Who can see it, or a moment for it to go public. */
type Choice = Privacy | 'scheduled';

/** Who can see the video: one row of four, the chosen one marked. */
const VisibilityChoice: React.FC<{ value: Choice; onChange: (choice: Choice) => void; disabled: boolean }> = ({ value, onChange, disabled }) => {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t.youtube.privacyLabel} className="grid grid-cols-4 gap-1.5">
      {(['private', 'unlisted', 'public', 'scheduled'] as const).map(option => (
        <button
          key={option}
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          disabled={disabled}
          className={`py-2 rounded-lg border text-xs transition-colors disabled:opacity-60 ${
            value === option
              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200 font-semibold'
              : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
          }`}
        >
          {t.youtube.privacy[option]}
        </button>
      ))}
    </div>
  );
};

/** The date and time a scheduled upload goes public, in the person's own time zone. */
const ScheduleField: React.FC<{ value: string; onChange: (value: string) => void; disabled: boolean; problem: string | null }> = ({
  value, onChange, disabled, problem
}) => {
  const t = useT();
  return (
    <label className="flex flex-col gap-1 text-[11px] text-slate-300">
      {t.youtube.scheduleLabel}
      <input
        type="datetime-local"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
      />
      {problem && <span role="status" className="text-amber-300/90">{problem}</span>}
    </label>
  );
};

/** The one action: sign in if needed, then send. */
const UploadButton: React.FC<{ onClick: () => void; busy: boolean }> = ({ onClick, busy }) => {
  const t = useT();
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
      {t.youtube.upload}
    </button>
  );
};

/**
 * Uploads the render to the user's YouTube channel, signed in to Google in a
 * pop-up -- see `youtubeUpload`. Only shown when the studio has a Google
 * client id to sign in with.
 */
export const YouTubeUpload: React.FC<YouTubeUploadProps> = props => {
  const t = useT();
  const { mode } = useStudioConfig();
  // A personal studio is someone posting to their own channel on a routine:
  // scheduled, for six in the evening. A public one starts private.
  const [picked, setPicked] = useState<Choice | null>(null);
  const choice: Choice = picked ?? (mode === 'personal' ? 'scheduled' : 'private');
  const [scheduleAt, setScheduleAt] = useState(() =>
    defaultScheduleValue(new Date(), mode === 'personal' ? PERSONAL_SCHEDULE_HOUR : undefined)
  );
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { stage, upload, cancel } = useYouTubeUpload(props);
  const busy = stage.kind === 'signing' || stage.kind === 'uploading';

  const pending: UnsentUpload = busy ? 'uploading' : touched && stage.kind !== 'done' ? 'unsent' : null;
  const { onUnsent } = props;
  useEffect(() => { onUnsent?.(pending); }, [onUnsent, pending]);
  useEffect(() => () => onUnsent?.(null), [onUnsent]);

  const start = () => {
    setTouched(true);
    if (choice !== 'scheduled') return upload(choice);
    // Checked before signing in: a time already gone is not worth a pop-up.
    const when = scheduleTime(scheduleAt);
    if (typeof when === 'string') return setProblem(when === 'past' ? t.youtube.schedulePast : t.youtube.scheduleInvalid);
    setProblem(null);
    return upload('private', when.publishAt);
  };

  return (
    <div className="flex flex-col gap-2">
      <VisibilityChoice value={choice} onChange={next => { setPicked(next); setTouched(true); setProblem(null); }} disabled={busy} />
      {choice === 'scheduled' && (
        <ScheduleField value={scheduleAt} onChange={next => { setScheduleAt(next); setTouched(true); }} disabled={busy} problem={problem} />
      )}
      <UploadButton onClick={start} busy={busy} />
      <details className="text-[11px] leading-relaxed text-slate-400">
        <summary className="cursor-pointer select-none">{t.youtube.privateUntilVerified}</summary>
        <p className="mt-1">{t.youtube.help}</p>
      </details>
      <StageNote stage={stage} onCancel={cancel} />
    </div>
  );
};
