'use client';

import React from 'react';
import { EXPORT_PRESETS, type ExportPlan } from '@/lib/exportPresets';
import { useT } from './LocaleProvider';

/**
 * Where the clip is going, as a checklist: one render per platform ticked.
 * Each says its shape and, before anything is rendered, whether it will be
 * re-laid out to that shape or runs longer than the platform takes.
 */
export const DestinationPicker: React.FC<{
  selected: string[];
  onToggle: (presetId: string) => void;
  studioAspect: string;
  plans: Record<string, ExportPlan>;
  disabled: boolean;
}> = ({ selected, onToggle, studioAspect, plans, disabled }) => {
  const t = useT();
  return (
    <fieldset className="min-w-0">
      <legend className="text-[13px] font-semibold text-slate-200 mb-2">
        {t.exportModal.presetLabel} <span className="font-normal text-slate-400">{t.exportModal.destinationsHint}</span>
      </legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {EXPORT_PRESETS.map(preset => {
          const on = selected.includes(preset.id);
          const note = plans[preset.id]?.overLongBy
            ? t.exportModal.tooLong
            : preset.aspectRatio !== studioAspect ? t.exportModal.relaidOut(preset.aspectRatio) : null;
          return (
            <label
              key={preset.id}
              className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold ${
                on ? 'border-amber-500 bg-amber-500/10' : 'border-slate-800 hover:border-slate-700'
              } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <input type="checkbox" checked={on} disabled={disabled} onChange={() => onToggle(preset.id)} className="w-4 h-4 accent-amber-500" />
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-slate-100 truncate">
                  {t.exportModal.presets[preset.id as keyof typeof t.exportModal.presets]}
                </span>
                {note && <span className="block text-xs text-amber-300">{note}</span>}
              </span>
              <span className="font-mono text-xs text-slate-400" dir="ltr">{preset.aspectRatio}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
};

export interface SegmentOption<T> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

/** One choice among a few, as native radios: arrow keys and a single Tab stop come with them. */
export function Segmented<T extends string | number>({ legend, name, options, value, onChange, disabled }: {
  legend: string;
  name: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-[13px] font-semibold text-slate-200 mb-2">{legend}</legend>
      <div className="grid gap-1 p-1 rounded-lg border border-slate-800 bg-slate-950" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map(option => (
          <label
            key={option.value}
            title={option.title}
            className={`h-9 rounded-md flex items-center justify-center text-[13px] font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold ${
              option.value === value ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
            } ${option.disabled || disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <input
              type="radio"
              name={name}
              checked={option.value === value}
              disabled={option.disabled || disabled}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
