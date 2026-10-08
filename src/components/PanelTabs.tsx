'use client';

import React from 'react';
import { useT } from './LocaleProvider';

export type PanelTab = 'source' | 'captions' | 'style';

const TABS: PanelTab[] = ['source', 'captions', 'style'];

/**
 * The working panel's three tabs, in the order a clip is made: what is
 * recited, what each caption says, how it looks. All three are reachable at
 * any time -- this orders the work, it does not gate it.
 *
 * The WAI-ARIA tabs pattern: one Tab stop, arrow keys move between tabs.
 */
export const PanelTabs: React.FC<{ value: PanelTab; onChange: (tab: PanelTab) => void; toCheck: number }> = ({
  value, onChange, toCheck
}) => {
  const t = useT();
  const labels: Record<PanelTab, string> = { source: t.panel.source, captions: t.panel.captions, style: t.panel.style };
  const step = (from: PanelTab, by: number) => {
    const next = TABS[(TABS.indexOf(from) + by + TABS.length) % TABS.length];
    onChange(next);
    document.getElementById(`panel-tab-${next}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={t.panel.label} className="hidden lg:grid grid-cols-3 shrink-0 border-b border-slate-800">
      {TABS.map((tab, i) => (
        <button
          key={tab}
          id={`panel-tab-${tab}`}
          data-tour={`tab-${tab}`}
          role="tab"
          aria-selected={value === tab}
          aria-controls={`panel-${tab}`}
          tabIndex={value === tab ? 0 : -1}
          onClick={() => onChange(tab)}
          onKeyDown={e => {
            // Logical, so the arrow that points at the next tab moves to it in Arabic too.
            const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
            if (e.key === 'ArrowRight') { e.preventDefault(); step(tab, rtl ? -1 : 1); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); step(tab, rtl ? 1 : -1); }
          }}
          className={`relative h-12 flex items-center justify-center gap-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold ${
            value === tab ? 'text-parchment' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span className={`font-mono text-[11px] ${value === tab ? 'text-gold' : 'text-slate-500'}`}>{i + 1}</span>
          {labels[tab]}
          {tab === 'captions' && toCheck > 0 && (
            <span className="min-w-5 h-5 px-1.5 rounded-full bg-gold text-ink text-[11px] font-bold flex items-center justify-center" title={t.panel.toCheck(toCheck)}>
              {toCheck}
              <span className="sr-only"> — {t.panel.toCheck(toCheck)}</span>
            </span>
          )}
          <span className={`absolute inset-x-0 bottom-0 h-0.5 ${value === tab ? 'bg-gold' : 'bg-transparent'}`} />
        </button>
      ))}
    </div>
  );
};
