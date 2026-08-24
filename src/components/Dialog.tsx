'use client';

import React, { useCallback, useEffect, useRef } from 'react';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Names the dialog for assistive tech. Required -- an unnamed dialog is announced as nothing. */
  label: string;
  children: React.ReactNode;
  /** Classes for the panel itself. The backdrop and centring are handled here. */
  panelClassName?: string;
  /** Backdrop layout: centred (modals) or pinned to the right edge (drawers). */
  placement?: 'center' | 'right';
  /**
   * Blocks Escape, the backdrop and the close button while something
   * uninterruptible is running -- an export mid-render, for instance.
   */
  dismissible?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The one dialog in the app.
 *
 * Every modal here used to be written from scratch, and all three independently
 * missed the same four things: dialog semantics, moving focus in, Escape, and
 * dismissing on the backdrop. Keyboard users had no way out except tabbing into
 * the page behind the dialog to find the close button.
 *
 * Focus is moved to the panel on open, trapped while it is open, and returned
 * to whatever opened it on close -- otherwise the tab position is lost to the
 * top of the document every time a dialog is dismissed.
 */
export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  label,
  children,
  panelClassName = '',
  placement = 'center',
  dismissible = true
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  // Read by the key handler, which is registered once per open rather than on
  // every change of `dismissible` -- an export flipping it mid-render should
  // not tear the listener down.
  const dismissibleRef = useRef(dismissible);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    dismissibleRef.current = dismissible;
    onCloseRef.current = onClose;
  }, [dismissible, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    restoreRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissibleRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const node = panelRef.current;
      if (!node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        el => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!node.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus?.({ preventScroll: true });
    };
  }, [isOpen]);

  const onBackdropPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only a press that both starts and lands on the backdrop dismisses, so
      // a drag that began inside the panel never closes it by accident.
      if (e.target !== e.currentTarget) return;
      if (!dismissibleRef.current) return;
      onCloseRef.current();
    },
    []
  );

  if (!isOpen) return null;

  return (
    <div
      onPointerDown={onBackdropPointerDown}
      className={`fixed inset-0 z-50 flex p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in ${
        placement === 'right' ? 'justify-end items-stretch p-0' : 'items-center justify-center'
      }`}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`focus:outline-none ${panelClassName}`}
      >
        {children}
      </div>
    </div>
  );
};
