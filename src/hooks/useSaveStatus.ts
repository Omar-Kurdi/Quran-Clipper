'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * What the header says about the last save, or the last ground-truth write.
 *
 * `detail` is the part worth reading: why a save failed, or what a save that
 * worked could not keep. `action` names what failed, so it can be tried again
 * with the studio as it is now rather than as it was when it failed.
 */
export interface SaveStatus {
  text: string;
  kind: 'pending' | 'ok' | 'error';
  detail?: string;
  action?: 'save' | 'ground-truth';
}

/**
 * Whether a status stays on screen until it is dismissed.
 *
 * A failure, and anything that carries a detail, does. Both used to leave after
 * eight seconds with the detail in a tooltip: no way to read it on a phone, and
 * gone before it could be copied on a desktop. A plain "saved" still goes away
 * on its own.
 */
export const staysUp = (status: SaveStatus | null): status is SaveStatus =>
  !!status && status.kind !== 'pending' && (status.kind === 'error' || !!status.detail);

/**
 * The status and its setter. `clearAfterMs` removes a status that needs no
 * reading; one timer, cancelled by whatever is shown next, so an older
 * status's timer cannot take a newer one away.
 */
export function useSaveStatus() {
  const [status, setStatus] = useState<SaveStatus | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: SaveStatus | null, clearAfterMs?: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setStatus(next);
    if (next && clearAfterMs && !staysUp(next)) timer.current = setTimeout(() => setStatus(null), clearAfterMs);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return [status, show] as const;
}
