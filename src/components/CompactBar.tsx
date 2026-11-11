'use client';

import React, { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useDismiss } from '@/hooks/useDismiss';
import { scrollParent } from './PanelGroup';

export interface CompactItem {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  /** What the control is, for the hover title and screen readers. */
  label: string;
  /** What it is set to, shown on the chip; without one the chip is its icon alone. */
  value?: string;
  /** The control itself, opened under the bar. */
  panel: React.ReactNode;
}

/**
 * The panel's settings, kept in reach while a long list below them is
 * scrolled: once `watch` -- the settings as laid out in full -- has scrolled
 * away, a bar of chips is held under the panel's head, each saying what its
 * setting is, and pressing one opens that setting right there.
 *
 * Laid over the list rather than in it, so its appearing never moves what is
 * being looked at.
 */
export const CompactBar: React.FC<{ watch: RefObject<HTMLElement | null>; items: CompactItem[] }> = ({ watch, items }) => {
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(null), []);
  useDismiss(open !== null, close, rootRef);

  useEffect(() => {
    const target = watch.current;
    const root = scrollParent(target);
    if (!target || !root) return;
    const onScroll = () => {
      const past = target.getBoundingClientRect().bottom < root.getBoundingClientRect().top + 48;
      setShown(past);
      if (!past) setOpen(null);
    };
    onScroll();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [watch]);

  const opened = items.find(item => item.id === open);
  return (
    <div className="sticky top-12 z-20 h-0 -mx-4" aria-hidden={!shown}>
      <div
        ref={rootRef}
        className={`absolute inset-x-0 top-0 bg-slate-900/95 backdrop-blur-sm border-b border-slate-800 shadow-lg shadow-black/30 transition-all duration-150 ${
          shown ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'
        }`}
      >
        <div className="px-3 py-2 flex gap-1">
          {items.map(item => (
            <Chip key={item.id} item={item} shown={shown} open={open === item.id} onToggle={() => setOpen(current => (current === item.id ? null : item.id))} />
          ))}
        </div>
        {opened && <div className="max-h-[60vh] overflow-y-auto px-4 pb-3">{opened.panel}</div>}
      </div>
    </div>
  );
};

/** One chip of the bar: its icon and value, lit while its setting is open. */
const Chip: React.FC<{ item: CompactItem; shown: boolean; open: boolean; onToggle: () => void }> = ({ item, shown, open, onToggle }) => {
  const { icon: Icon, label, value } = item;
  return (
    <button
      type="button"
      tabIndex={shown ? 0 : -1}
      title={label}
      aria-label={value ? `${label}: ${value}` : label}
      aria-expanded={open}
      onClick={onToggle}
      className={`min-w-0 ${value ? 'flex-1' : 'shrink-0'} flex items-center justify-center gap-1 px-2 py-1 rounded-full border text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
        open ? 'border-gold bg-gold/10 text-gold' : 'border-slate-700 text-slate-300 hover:border-slate-500'
      }`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {value && <span className="truncate">{value}</span>}
    </button>
  );
};
