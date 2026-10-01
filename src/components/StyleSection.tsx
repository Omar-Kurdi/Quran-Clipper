'use client';

import React from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * One collapsible part of the Style tab. Closed, it still says what it is set
 * to, so the whole look can be read without opening anything.
 */
export const StyleSection: React.FC<{
  id: string;
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ id, title, summary, open, onToggle, children }) => (
  <section className="rounded-xl border border-slate-800">
    <h3>
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`style-section-${id}`}
        className={`w-full min-h-12 flex items-center gap-3 px-3.5 py-2.5 text-start rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
          open ? 'bg-slate-900' : 'hover:bg-slate-900/60'
        }`}
      >
        <span className="text-sm font-semibold text-slate-100">{title}</span>
        <span className="flex-1 min-w-0 truncate text-end text-xs text-slate-400">{summary}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
    </h3>
    {open && (
      <div id={`style-section-${id}`} className="px-3.5 pb-4 pt-2 flex flex-col gap-4">
        {children}
      </div>
    )}
  </section>
);
