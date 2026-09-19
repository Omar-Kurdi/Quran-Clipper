'use client';

import { useCallback, useEffect, useState } from 'react';
import { isActive, type RenderJob } from '@/lib/serverRender';

/** How often the list is re-read while something on it is still running. */
const POLL_MS = 1500;

interface ServerRenderState {
  available: boolean;
  jobs: RenderJob[];
}

/**
 * The server's renders, as the export dialog lists them.
 *
 * Read when the dialog opens and re-read while anything is still going, so a
 * render sent from a tab that has since been closed shows up with its file
 * the next time the dialog is opened -- which is the point of sending it.
 */
export function useServerRenders(open: boolean) {
  const [state, setState] = useState<ServerRenderState>({ available: false, jobs: [] });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await (await fetch('/api/render')).json();
      if (data.success) setState({ available: Boolean(data.available), jobs: data.jobs ?? [] });
    } catch {
      setState(current => ({ ...current, available: false }));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const first = window.setTimeout(refresh, 0);
    return () => window.clearTimeout(first);
  }, [open, refresh]);

  const running = state.jobs.some(isActive);
  useEffect(() => {
    if (!open || !running) return;
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, running, refresh]);

  /** Sends one render. `build` gathers the studio's state and files, which takes a moment for uploads. */
  const send = async (build: () => Promise<FormData>) => {
    setSending(true);
    setError(null);
    try {
      const data = await (await fetch('/api/render', { method: 'POST', body: await build() })).json();
      if (!data.success) setError(data.error || 'unknown error');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
      await refresh();
    }
  };

  /** Cancels a render still going, or removes one that has ended. */
  const discard = async (id: string) => {
    await fetch(`/api/render?id=${id}`, { method: 'DELETE' }).catch(() => undefined);
    await refresh();
  };

  return { ...state, sending, error, send, discard };
}
