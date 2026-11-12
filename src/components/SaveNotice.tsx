'use client';

import React from 'react';
import { AlertTriangle, CheckCircle, X } from 'lucide-react';
import { Button } from './Button';
import { useT } from './LocaleProvider';
import type { SaveStatus } from '@/hooks/useSaveStatus';

/**
 * The last save's outcome, when there is something to read: a strip under the
 * header, at every width, that stays until it is dismissed.
 *
 * The header's own line shows only the label ("Save Failed") and is hidden on
 * a phone; the reason sat in its tooltip. So a failed save on a phone showed
 * nothing at all, and on a desktop the cause had to be caught by hovering
 * within eight seconds.
 */
export const SaveNotice: React.FC<{
  status: SaveStatus;
  /** Runs what failed again, as the studio is now. Absent when there is nothing to retry. */
  onRetry?: () => void;
  onDismiss: () => void;
}> = ({ status, onRetry, onDismiss }) => {
  const t = useT();
  const failed = status.kind === 'error';
  return (
    <div
      role={failed ? 'alert' : 'status'}
      className={`shrink-0 z-20 flex items-start gap-2.5 px-3 sm:px-4 py-2 border-b text-xs leading-relaxed ${
        failed ? 'bg-red-500/10 border-red-500/30 text-red-200' : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-100'
      }`}
    >
      {failed
        ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" aria-hidden="true" />
        : <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" aria-hidden="true" />}
      <p className="flex-1 min-w-0 break-words">
        <span className="font-semibold">{status.text}</span>
        {status.detail && <span className="ms-1.5 opacity-90">{status.detail}</span>}
      </p>
      {failed && onRetry && (
        <Button size="sm" onClick={onRetry} className="shrink-0">{t.common.tryAgain}</Button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t.common.dismiss}
        title={t.common.dismiss}
        className="shrink-0 p-1 rounded-md opacity-80 hover:opacity-100 hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
