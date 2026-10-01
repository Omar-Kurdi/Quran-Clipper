'use client';

import React, { useCallback, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useT } from './LocaleProvider';
import { useDismiss } from '@/hooks/useDismiss';

export interface OverflowItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  /** Shown under the label, for status like "Saved" or a clip duration. */
  hint?: string;
  /** Extra classes on the row, e.g. `sm:hidden` for an entry the header shows itself above a breakpoint. */
  className?: string;
}

interface OverflowMenuProps {
  items: OverflowItem[];
  label?: string;
  /** The trigger's icon; a "more" ellipsis unless given. */
  icon?: React.ReactNode;
  /** Shown under the items: controls that are not one-click actions, like the theme list. */
  footer?: React.ReactNode;
}

/** One entry of the menu. Closing first, so an action that opens a dialog opens it over a closed menu. */
const MenuRow: React.FC<{ item: OverflowItem; onDone: () => void }> = ({ item, onDone }) => (
  <button
    role="menuitem"
    onClick={() => {
      onDone();
      item.onSelect();
    }}
    className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg hover:bg-slate-800 transition-colors text-start focus-visible:outline-none focus-visible:bg-slate-800 ${item.className ?? ''}`}
  >
    <span className="shrink-0 text-amber-400">{item.icon}</span>
    <span className="min-w-0">
      <span className="block text-[13px] font-semibold text-slate-100 truncate">{item.label}</span>
      {item.hint && <span className="block text-xs text-slate-400 truncate">{item.hint}</span>}
    </span>
  </button>
);

/**
 * A header menu: the secondary actions, kept out of the bar so Export is the
 * one primary action in it.
 */
export const OverflowMenu: React.FC<OverflowMenuProps> = ({ items, label, icon, footer }) => {
  const t = useT();
  const menuLabel = label ?? t.common.moreActions;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, rootRef);

  if (items.length === 0 && !footer) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={menuLabel}
        title={menuLabel}
        className="flex items-center justify-center w-9 h-9 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
      >
        {icon ?? <MoreHorizontal className="w-4 h-4" />}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={menuLabel}
          className="absolute end-0 top-full mt-1.5 w-64 p-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50"
        >
          {items.map(item => <MenuRow key={item.key} item={item} onDone={close} />)}
          {footer && <div className="mt-1 border-t border-slate-800 pt-1">{footer}</div>}
        </div>
      )}
    </div>
  );
};
