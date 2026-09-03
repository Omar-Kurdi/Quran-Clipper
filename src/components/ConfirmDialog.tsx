'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { useT } from './LocaleProvider';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** What will happen, in the user's terms. Name the thing being removed. */
  message: string;
  /** Defaults to the active language's word for "delete". */
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * "Are you sure?" for the one class of action that has no undo here.
 *
 * Removing a background was a single click on a 14px X sitting between two
 * other 14px buttons, and the list it removed from is the only record of what
 * was in the video -- a mis-click cost work with nothing to get it back from.
 * Cancel is the focused, default-looking button; confirming is the deliberate
 * one.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel
}) => {
  const t = useT();
  return (
  <Dialog isOpen={isOpen} onClose={onCancel} label={title} panelClassName="max-w-md">
    <div className="w-[min(24rem,88vw)] bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl">
      <div className="flex items-start gap-3">
        <span className="p-2 bg-red-500/15 text-red-400 rounded-xl border border-red-500/25 shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-100">{title}</h3>
          <p className="text-xs text-slate-300 mt-1 leading-relaxed">{message}</p>
        </div>
      </div>
      <div className="flex gap-2 mt-5">
        <Button size="md" onClick={onCancel} className="flex-1">{t.common.cancel}</Button>
        <Button size="md" variant="danger" onClick={onConfirm} className="flex-1">
          {confirmLabel ?? t.common.delete}
        </Button>
      </div>
    </div>
  </Dialog>
  );
};
