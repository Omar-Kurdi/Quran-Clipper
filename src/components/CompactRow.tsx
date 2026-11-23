'use client';

import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * The style panels' settings as one line each.
 *
 * A setting that takes a choice says what it is set to -- "Arabic font ›
 * Madani Mushaf", a colour as its swatch and hex -- and opens its full control
 * in place, under the line, when pressed; the panel holds one open at a time.
 * Sliders and switches are one line already, so they stay as they are. A panel
 * of twenty settings reads at a glance, and nothing is a dialog away.
 */

const ROW = 'w-full min-h-9 flex items-center gap-3 px-2 py-1.5 rounded-md text-start';

interface CompactRowProps {
  label: string;
  /** What the setting is now, shown at the line's end. */
  value?: React.ReactNode;
  /** A colour to show beside the value. */
  swatch?: string;
  /** Said when the row is hovered: what the setting does. */
  hint?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

/** A setting as one line saying its value; pressed, its control opens under it. */
export const CompactRow: React.FC<CompactRowProps> = ({ label, value, swatch, hint, open, onToggle, children }) => {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className={open ? 'rounded-lg bg-slate-900/60 ring-1 ring-slate-800' : undefined}>
      <button type="button" onClick={onToggle} aria-expanded={open} title={hint}
        className={`${ROW} hover:bg-slate-800/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold`}>
        <span className="flex-1 min-w-0 text-sm text-slate-200">{label}</span>
        <span className="min-w-0 flex items-center gap-1.5 text-xs text-slate-400">
          {swatch && <span aria-hidden className="w-3.5 h-3.5 shrink-0 rounded-sm border border-slate-600" style={{ background: swatch }} />}
          <span className="truncate">{value}</span>
        </span>
        <Chevron aria-hidden className="w-3.5 h-3.5 shrink-0 text-slate-500 rtl:-scale-x-100" />
      </button>
      {open && <div className="px-2 pb-2.5 pt-1 flex flex-col gap-2">{children}</div>}
    </div>
  );
};

interface ChoiceRowProps<T extends string> extends Omit<CompactRowProps, 'value' | 'children'> {
  options: readonly { id: T; label: string; disabled?: boolean }[];
  chosen: T;
  /** Choosing also closes the row: the line then says what was chosen. */
  onChoose: (id: T) => void;
  /** Said under the options, once open. */
  children?: React.ReactNode;
}

/** A row whose control is a short list of choices. */
export function ChoiceRow<T extends string>({ options, chosen, onChoose, children, ...row }: ChoiceRowProps<T>) {
  return (
    <CompactRow {...row} value={options.find(option => option.id === chosen)?.label ?? chosen}>
      <div role="radiogroup" aria-label={row.label} className="flex flex-col">
        {options.map(option => (
          <button key={option.id} type="button" role="radio" aria-checked={option.id === chosen} disabled={option.disabled}
            onClick={() => { onChoose(option.id); row.onToggle(); }}
            className={`px-2 py-1.5 rounded-md text-start text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              option.id === chosen ? 'bg-amber-500/15 text-amber-200 font-semibold' : 'text-slate-300 hover:bg-slate-800/60'
            }`}>
            {option.label}
          </button>
        ))}
      </div>
      {children}
    </CompactRow>
  );
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** After the number, as in "45px" or "60%". */
  unit?: string;
  onChange: (value: number) => void;
}

/** A slider, on the line of its label, its value at the end. */
export const SliderRow: React.FC<SliderRowProps> = ({ label, value, min, max, unit = '', onChange }) => (
  <label className={ROW}>
    <span className="w-28 shrink-0 text-sm text-slate-200">{label}</span>
    <input type="range" min={min} max={max} value={value} onChange={e => onChange(parseInt(e.target.value, 10))}
      className="flex-1 min-w-0 accent-amber-500" />
    <span className="w-11 shrink-0 text-end font-mono text-xs text-amber-400" dir="ltr">{value}{unit}</span>
  </label>
);

interface SwitchRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** An on/off setting, the switch at the end of its line. */
export const SwitchRow: React.FC<SwitchRowProps> = ({ label, hint, checked, onChange }) => (
  <button type="button" role="switch" aria-checked={checked} title={hint} onClick={() => onChange(!checked)}
    className={`${ROW} hover:bg-slate-800/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold`}>
    <span className="flex-1 min-w-0 text-sm text-slate-200">{label}</span>
    <span aria-hidden className={`relative w-8 h-[18px] shrink-0 rounded-full transition-colors ${checked ? 'bg-amber-500' : 'bg-slate-700'}`}>
      <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-[inset-inline-start] ${checked ? 'start-4' : 'start-0.5'}`} />
    </span>
  </button>
);
