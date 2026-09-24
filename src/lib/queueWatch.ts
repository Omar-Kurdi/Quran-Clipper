/**
 * Asks the server where one match stands while its request is waiting, and
 * reports each answer. See `matchQueue` for the queue itself.
 *
 * The match request is what waits; this only watches it, so a watch that
 * fails -- the status route unreachable, say -- changes nothing about the
 * match, and simply reports nothing.
 */

export interface QueueSighting {
  position: number;
  etaSeconds: number | null;
}

export const newMatchTicket = () =>
  `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

/** Starts watching; returns the function that stops. */
export function watchQueue(ticket: string, onSighting: (seen: QueueSighting) => void, everyMs = 2000): () => void {
  let stopped = false;
  const look = () => {
    fetch(`/api/audio/queue?ticket=${encodeURIComponent(ticket)}`)
      .then(res => (res.ok ? res.json() : null))
      .then(body => {
        if (!stopped && typeof body?.position === 'number') {
          onSighting({ position: body.position, etaSeconds: typeof body.etaSeconds === 'number' ? body.etaSeconds : null });
        }
      })
      .catch(() => {});
  };
  const timer = setInterval(look, everyMs);
  look();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** `about 45s`, `about 2 min` -- how long to expect, never falsely precise. */
export function roughWait(seconds: number): string {
  if (seconds < 60) return `${Math.max(5, Math.round(seconds / 5) * 5)}s`;
  return `${Math.round(seconds / 60)} min`;
}
