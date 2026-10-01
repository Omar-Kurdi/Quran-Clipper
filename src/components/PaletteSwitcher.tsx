'use client';

import React, { useEffect, useState } from 'react';
import { Palette, Check } from 'lucide-react';
import { useT } from './LocaleProvider';

/**
 * Colour schemes offered in the studio header.
 *
 * The three swatches are literal hex rather than the live CSS variables on
 * purpose: a menu row has to show the palette it *would* switch to, not the one
 * currently applied. Keep them in step with the blocks in globals.css.
 *
 * The name and the one-line note live in the dictionary, keyed by this id -- a
 * palette is called something different in each language, but it is the same
 * three colours either way.
 */
export const PALETTES = [
  { id: 'nocturne', swatches: ['#0a0f1a', '#8fb3e8', '#56b6c2'] },
  { id: 'slate', swatches: ['#020617', '#f59e0b', '#34d399'] },
  { id: 'mushaf', swatches: ['#12101a', '#c9a227', '#3d6bc4'] },
  { id: 'graphite', swatches: ['#131315', '#b9975b', '#6f9bc4'] },
  { id: 'verdigris', swatches: ['#0d1412', '#b8944d', '#5eb39b'] },
  { id: 'maghrib', swatches: ['#150f17', '#e8916f', '#9d8fe0'] },
  { id: 'qahwa', swatches: ['#15110d', '#d9a55b', '#7fb8a4'] }
] as const;

const STORAGE_KEY = 'qc-palette';
const DEFAULT_PALETTE = 'slate';

/** One palette, drawn as the three colours it would switch to. */
const PaletteRow: React.FC<{ palette: (typeof PALETTES)[number]; active: boolean; onChoose: () => void }> = ({
  palette, active, onChoose
}) => {
  const t = useT();
  return (
    <button
      role="menuitemradio"
      aria-checked={active}
      onClick={onChoose}
      title={t.palette.notes[palette.id]}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-800 transition-colors text-start focus-visible:outline-none focus-visible:bg-slate-800"
    >
      <span className="flex items-center gap-0.5 shrink-0">
        {palette.swatches.map(c => (
          <span key={c} className="w-3.5 h-3.5 rounded-sm border border-black/30" style={{ background: c }} />
        ))}
      </span>
      <span className="flex-1 min-w-0 text-[13px] font-semibold text-slate-100 truncate">{t.palette.names[palette.id]}</span>
      {active && <Check className="w-3.5 h-3.5 text-gold shrink-0" />}
    </button>
  );
};

/**
 * The colour schemes as a list of choices, for the header's ⋯ menu.
 *
 * Mounted only when that menu opens, so reading the live palette for its
 * initial state cannot disagree with a server render.
 */
export const PaletteList: React.FC = () => {
  const t = useT();
  const [active, setActive] = useState<string>(
    () => document.documentElement.dataset.palette || DEFAULT_PALETTE
  );

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
  };

  return (
    <div role="group" aria-label={t.palette.title}>
      <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-xs font-semibold text-slate-400">
        <Palette className="w-3.5 h-3.5 text-gold" aria-hidden="true" />
        {t.palette.label}
      </div>
      {PALETTES.map(p => (
        <PaletteRow key={p.id} palette={p} active={active === p.id} onChoose={() => choose(p.id)} />
      ))}
    </div>
  );
};
