'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

export interface OverflowItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  /** Shown under the label, for status like "Saved" or a clip duration. */
  hint?: string;
}

/**
 * Collapses secondary toolbar actions on narrow screens.
 *
 * The header carried five controls side by side, which at 375px pushed the
 * primary action to 42% visible and made the bar silently scroll sideways.
 * Secondary actions move in here below the breakpoint so the primary one keeps
 * its place.
 */
export const OverflowMenu: React.FC<{ items: OverflowItem[]; label?: string }> = ({
  items,
  label = 'More actions'
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="flex items-center justify-center px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-56 p-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50"
        >
          {items.map(item => (
            <button
              key={item.key}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg hover:bg-slate-800 transition-colors text-left focus-visible:outline-none focus-visible:bg-slate-800"
            >
              <span className="shrink-0 text-amber-400">{item.icon}</span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-slate-100 truncate">{item.label}</span>
                {item.hint && <span className="block text-[11px] text-slate-400 truncate">{item.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
