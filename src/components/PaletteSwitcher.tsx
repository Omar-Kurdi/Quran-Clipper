'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Palette, Check } from 'lucide-react';

/**
 * Colour schemes offered in the studio header.
 *
 * The three swatches are literal hex rather than the live CSS variables on
 * purpose: a menu row has to show the palette it *would* switch to, not the one
 * currently applied. Keep them in step with the blocks in globals.css.
 */
export const PALETTES = [
  { id: 'nocturne', name: 'Nocturne', note: 'Navy and pearl', swatches: ['#0a0f1a', '#b8c7dc', '#56b6c2'] },
  { id: 'slate', name: 'Slate & Amber', note: 'The original', swatches: ['#020617', '#f59e0b', '#34d399'] },
  { id: 'mushaf', name: 'Mushaf', note: 'Gold and lapis', swatches: ['#12101a', '#c9a227', '#3d6bc4'] },
  { id: 'graphite', name: 'Graphite', note: 'Neutral grey', swatches: ['#131315', '#b9975b', '#6f9bc4'] },
  { id: 'verdigris', name: 'Verdigris', note: 'Green and brass', swatches: ['#0d1412', '#b8944d', '#5eb39b'] }
] as const;

const STORAGE_KEY = 'qc-palette';
const DEFAULT_PALETTE = 'nocturne';

export const PaletteSwitcher: React.FC = () => {
  const [open, setOpen] = useState(false);
  // Never read during render: the inline script in layout.tsx may already have
  // set a different palette, and rendering that value on the server would
  // hydrate-mismatch. It is synced when the menu opens instead.
  const [active, setActive] = useState<string>(DEFAULT_PALETTE);
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

  const toggle = () => {
    if (!open) setActive(document.documentElement.dataset.palette || DEFAULT_PALETTE);
    setOpen(o => !o);
  };

  // The DOM write lives in an effect rather than the click handler: mutating
  // documentElement during an event is exactly what react-hooks/refs rejects.
  // `pending` stays null until a real choice is made, so mounting never
  // overwrites the palette the inline script already restored.
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    if (pending === null) return;
    document.documentElement.dataset.palette = pending;
    try {
      localStorage.setItem(STORAGE_KEY, pending);
    } catch {
      // Private browsing can refuse storage; the choice still applies for this
      // session, which is better than blocking the switch.
    }
  }, [pending]);

  const choose = (id: string) => {
    setPending(id);
    setActive(id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change the studio colour scheme"
        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
      >
        <Palette className="w-3.5 h-3.5 text-gold" />
        <span className="hidden sm:inline">Theme</span>
        {/* Reads the live palette straight from CSS, so it is correct on the
            first paint without any JavaScript state. */}
        <span className="w-3 h-3 rounded-full bg-gold border border-slate-950/40" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-60 p-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50"
        >
          {PALETTES.map(p => (
            <button
              key={p.id}
              role="menuitemradio"
              aria-checked={active === p.id}
              onClick={() => choose(p.id)}
              className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-800 transition-colors text-left focus-visible:outline-none focus-visible:bg-slate-800"
            >
              <span className="flex items-center gap-0.5 shrink-0">
                {p.swatches.map(c => (
                  <span
                    key={c}
                    className="w-3.5 h-3.5 rounded-sm border border-black/30"
                    style={{ background: c }}
                  />
                ))}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-semibold text-slate-100 truncate">{p.name}</span>
                <span className="block text-[11px] text-slate-400 truncate">{p.note}</span>
              </span>
              {active === p.id && <Check className="w-3.5 h-3.5 text-gold shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
