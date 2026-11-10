'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, Upload } from 'lucide-react';
import type { PublishMetadata } from '@/lib/publishMetadata';
import { postText } from '@/lib/postTargets';
import {
  TIKTOK_CHANNEL, TIKTOK_CONNECT_PATH, chunkRange, draftStatus, tiktokFailure, type ChunkPlan, type TikTokFailure
} from '@/lib/tiktokUpload';
import { useT } from './LocaleProvider';
import type { UnsentUpload } from './YouTubeUpload';

/** Whether this studio offers TikTok, and whether this browser is signed in to it. */
type TikTokState = { configured: boolean; connected: boolean };

const post = (path: string, body?: unknown) =>
  fetch(`/api/tiktok/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'quranclipper' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

let asked: Promise<TikTokState> | null = null;

/** Asked once a page, however many renders show the panel; asked again after signing in or out. */
export function tiktokState(fresh = false): Promise<TikTokState> {
  if (fresh || !asked) {
    asked = post('state')
      .then(res => res.json() as Promise<Partial<TikTokState>>)
      .then(body => ({ configured: Boolean(body.configured), connected: Boolean(body.connected) }))
      .catch(() => ({ configured: false, connected: false }));
  }
  return asked;
}

/** Whether to offer TikTok at all: only where the studio's server has a TikTok app. */
export function useTikTokOffered(): boolean {
  const [offered, setOffered] = useState(false);
  useEffect(() => {
    let live = true;
    void tiktokState().then(state => { if (live) setOffered(state.configured); });
    return () => { live = false; };
  }, []);
  return offered;
}

class TikTokError extends Error {
  constructor(readonly failure: TikTokFailure) {
    super(failure);
  }
}

/**
 * TikTok's sign-in, in a pop-up opened by the click itself. Its last page
 * reports on a BroadcastChannel; a pop-up closed without it is a sign-in that
 * did not finish.
 */
function signIn(): Promise<void> {
  const popup = window.open(TIKTOK_CONNECT_PATH, 'qc-tiktok', 'width=520,height=760');
  if (!popup) return Promise.reject(new TikTokError('popup'));
  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(TIKTOK_CHANNEL);
    const finish = (outcome: string) => {
      channel.close();
      window.clearInterval(watch);
      if (outcome === 'ok') resolve();
      else reject(new TikTokError(outcome === 'scope' ? 'rejected' : 'signin'));
    };
    channel.onmessage = event => finish((event.data as { outcome?: string })?.outcome ?? 'failed');
    // TikTok's pages can cut the pop-up off from this tab, so `closed` may read
    // true early; the server is asked before calling it a failure.
    const watch = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(watch);
      void tiktokState(true).then(state => finish(state.connected ? 'ok' : 'failed'));
    }, 800);
  });
}

/** Sends one piece through the studio's server, reporting its own progress from 0 to 1. */
function sendPiece(uploadUrl: string, piece: Blob, range: string, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/tiktok/chunk');
    xhr.setRequestHeader('X-Requested-With', 'quranclipper');
    xhr.setRequestHeader('X-Upload-Url', uploadUrl);
    xhr.setRequestHeader('X-Content-Range', range);
    xhr.setRequestHeader('Content-Type', piece.type || 'video/mp4');
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new TikTokError(tiktokFailure(xhr.status))));
    xhr.onerror = () => reject(new TikTokError('network'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.onabort = () => reject(new DOMException('Upload cancelled.', 'AbortError'));
    xhr.send(piece);
  });
}

async function failureFrom(res: Response): Promise<TikTokError> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new TikTokError(tiktokFailure(res.status, body.error));
}

/** Where the draft stands after a few looks, a few seconds apart: in the inbox, posted, still processing, or why it failed. */
async function settle(publishId: string): Promise<'inbox' | 'posted' | 'processing'> {
  for (let look = 0; look < 8; look++) {
    await new Promise(r => setTimeout(r, 3000));
    const res = await post('status', { publishId });
    if (!res.ok) throw await failureFrom(res);
    const body = (await res.json()) as { status?: string; failReason?: string };
    const status = draftStatus(body.status);
    if (status === 'failed') throw new TikTokError(tiktokFailure(200, body.failReason));
    if (status !== 'processing') return status;
  }
  return 'processing';
}

/**
 * The whole file, piece by piece and in order -- TikTok takes them no other
 * way -- reporting progress over the whole from 0 to 1.
 */
async function sendAll(blob: Blob, plan: { uploadUrl: string } & ChunkPlan, onProgress: (fraction: number) => void, signal: AbortSignal) {
  for (let i = 0; i < plan.count; i++) {
    const { start, end } = chunkRange(i, plan, blob.size);
    await sendPiece(plan.uploadUrl, blob.slice(start, end, blob.type || 'video/mp4'), `bytes ${start}-${end - 1}/${blob.size}`,
      fraction => onProgress((start + fraction * (end - start)) / blob.size), signal);
  }
}

/**
 * One upload at a time from this page: TikTok replaces the refresh token on
 * every refresh, so two uploads refreshing together would leave one holding
 * a token TikTok has already retired.
 */
let queue: Promise<unknown> = Promise.resolve();

type Stage =
  | { kind: 'idle' }
  | { kind: 'signing' }
  | { kind: 'uploading'; progress: number }
  | { kind: 'checking' }
  | { kind: 'done'; where: 'inbox' | 'posted' | 'processing' }
  | { kind: 'failed'; failure: TikTokFailure | 'cancelled' };

function useTikTokUpload(blob: Blob) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [connected, setConnected] = useState<boolean | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    void tiktokState().then(state => setConnected(state.connected));
    return () => abort.current?.abort();
  }, []);

  const upload = async () => {
    // The pop-up opens here, inside the click, or the browser blocks it.
    const signing = connected ? Promise.resolve() : signIn();
    // Awaited below, behind any upload already going; handled here so a
    // pop-up refused at once is not reported as unhandled meanwhile.
    signing.catch(() => undefined);
    setStage(connected ? { kind: 'uploading', progress: 0 } : { kind: 'signing' });
    const run = queue.then(async () => {
      await signing;
      setConnected(true);
      setStage({ kind: 'uploading', progress: 0 });
      const res = await post('init', { size: blob.size });
      if (!res.ok) throw await failureFrom(res);
      const plan = (await res.json()) as { publishId: string; uploadUrl: string } & ChunkPlan;
      abort.current = new AbortController();
      await sendAll(blob, plan, progress => setStage({ kind: 'uploading', progress }), abort.current.signal);
      setStage({ kind: 'checking' });
      return plan.publishId;
    });
    queue = run.catch(() => undefined);
    try {
      const publishId = await run;
      setStage({ kind: 'done', where: publishId ? await settle(publishId) : 'processing' });
    } catch (err) {
      const failure = err instanceof TikTokError ? err.failure : (err as Error)?.name === 'AbortError' ? 'cancelled' : 'other';
      if (failure === 'signin') void tiktokState(true).then(state => setConnected(state.connected));
      setStage({ kind: 'failed', failure });
    }
  };

  const signOut = async () => {
    await post('disconnect').catch(() => undefined);
    await tiktokState(true);
    setConnected(false);
  };

  return { stage, connected, upload, cancel: () => abort.current?.abort(), signOut };
}

/** The caption, copied by its own click: TikTok drafts carry no caption, so it is pasted in the app. */
const CopyCaption: React.FC<{ caption: () => Promise<PublishMetadata> }> = ({ caption }) => {
  const t = useT();
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(postText(await caption()));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button onClick={() => void copy()} className="self-start flex items-center gap-1 text-[11px] text-slate-300 hover:text-emerald-300 underline">
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied === false ? t.tiktok.copyFailed : copied ? t.tiktok.copied : t.tiktok.copyCaption}
    </button>
  );
};

/** What happened, once something has. */
const StageNote: React.FC<{ stage: Stage; onCancel: () => void }> = ({ stage, onCancel }) => {
  const t = useT();
  if (stage.kind === 'signing') return <p className="text-[11px] text-slate-300">{t.tiktok.signingIn}</p>;
  if (stage.kind === 'checking') return <p className="text-[11px] text-slate-300">{t.tiktok.checking}</p>;
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
  if (stage.kind === 'done') return <p role="status" className="text-[11px] leading-relaxed text-emerald-300">{t.tiktok.done[stage.where]}</p>;
  if (stage.kind === 'failed') return <p role="status" className="text-[11px] leading-relaxed text-amber-300/90">{t.tiktok.failed[stage.failure]}</p>;
  return null;
};

/**
 * Sends the render to the person's TikTok inbox as a draft, to finish and post
 * in the TikTok app -- see `tiktokUpload`. Only shown where the studio's
 * server has a TikTok app (`useTikTokOffered`).
 */
export const TikTokUpload: React.FC<{
  blob: Blob;
  caption: () => Promise<PublishMetadata>;
  onUnsent?: (pending: UnsentUpload) => void;
}> = ({ blob, caption, onUnsent }) => {
  const t = useT();
  const { stage, connected, upload, cancel, signOut } = useTikTokUpload(blob);
  const busy = stage.kind === 'signing' || stage.kind === 'uploading' || stage.kind === 'checking';
  const pending: UnsentUpload = stage.kind === 'signing' || stage.kind === 'uploading' ? 'uploading' : null;
  useEffect(() => { onUnsent?.(pending); }, [onUnsent, pending]);
  useEffect(() => () => onUnsent?.(null), [onUnsent]);

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => void upload()}
        disabled={busy}
        className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {t.tiktok.upload}
      </button>
      <p className="text-[11px] leading-relaxed text-slate-400">{t.tiktok.help}</p>
      <CopyCaption caption={caption} />
      {connected && (
        <p className="text-[11px] text-slate-400">
          {t.tiktok.keptSignedIn}{' '}
          <button onClick={() => void signOut()} disabled={busy} className="underline hover:text-slate-200">{t.youtube.disconnect}</button>
        </p>
      )}
      <StageNote stage={stage} onCancel={cancel} />
    </div>
  );
};
