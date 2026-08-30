'use client';

import React, { useState } from 'react';

interface ColorFieldProps {
  label: string;
  /** What this colour actually paints. Shown under the label. */
  description?: string;
  value: string;
  onChange: (hex: string) => void;
}

/**
 * A colour picker that stays inside the page.
 *
 * `<input type="color">` hands the job to the operating system, and the OS puts
 * its dialog wherever it likes -- on a multi-monitor setup that turned out to
 * be a different screen from the studio. So the sliders and the hex field are
 * ordinary markup in the panel and always work where the swatch is.
 *
 * The native picker is still offered, as the last cell of the swatch grid:
 * eleven quick picks read as the only eleven colours on offer, and an eyedropper
 * and a colour wheel are worth a wandering dialog when you actually want them.
 *
 * It expands in the flow rather than floating: the inspector column scrolls,
 * and an absolutely positioned popover either clips against that scroller or
 * needs collision handling to avoid it.
 */

/**
 * Eleven quick picks and, in the twelfth cell of the grid, the system colour
 * picker -- the swatches are a shortcut, never the whole offering.
 */
const PRESETS = [
  '#ffffff', '#f5eee0', '#e8eef7', '#b8c7dc',
  '#d4af37', '#f59e0b', '#c9a227', '#5fb59b',
  '#7fd3dd', '#d5dfec', '#94a3b8'
];

type Hsl = { h: number; s: number; l: number };

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, '');
  const expanded = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw;
  return /^[0-9a-fA-F]{6}$/.test(expanded) ? `#${expanded.toLowerCase()}` : null;
}

export function hexToHsl(hex: string): Hsl {
  const normalized = normalizeHex(hex) || '#ffffff';
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100) };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  const toByte = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

export const ColorField: React.FC<ColorFieldProps> = ({ label, description, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  // Hue and saturation survive a trip through pure black, white or grey, where
  // the hex carries no hue at all. Reading them back off `value` every render
  // would snap the hue slider to 0 the moment lightness hit either end.
  const [hsl, setHsl] = useState<Hsl>(() => hexToHsl(value));
  // The hex this component last agreed with. When `value` arrives different --
  // a preset elsewhere, a loaded project -- the sliders re-derive from it; when
  // the change came from these sliders, it does not, and the hue survives.
  const [syncedHex, setSyncedHex] = useState(value.toLowerCase());

  if (value.toLowerCase() !== syncedHex) {
    setSyncedHex(value.toLowerCase());
    setHsl(hexToHsl(value));
  }

  const emit = (hex: string) => {
    setSyncedHex(hex.toLowerCase());
    onChange(hex);
  };

  const setChannel = (channel: keyof Hsl, raw: number) => {
    const next = { ...hsl, [channel]: clamp(raw, 0, channel === 'h' ? 360 : 100) };
    setHsl(next);
    emit(hslToHex(next));
  };

  const applyPreset = (hex: string) => {
    setHsl(hexToHsl(hex));
    emit(hex);
    setDraft(null);
  };

  const sliderClass = 'w-full accent-amber-500';

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 p-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold rounded-lg"
      >
        <span
          className="w-7 h-7 rounded-md border border-slate-700 shrink-0"
          style={{ background: value }}
        />
        <span className="flex-1 min-w-0">
          <span className="block text-[11px] font-semibold text-slate-200">{label}</span>
          {description && <span className="block text-[11px] text-slate-400 leading-snug">{description}</span>}
        </span>
        <span className="font-mono text-[11px] text-slate-400 shrink-0">{value}</span>
      </button>

      {open && (
        <div className="p-2 pt-0 flex flex-col gap-2">
          <div className="grid grid-cols-6 gap-1.5">
            {PRESETS.map(hex => (
              <button
                key={hex}
                type="button"
                title={hex}
                onClick={() => applyPreset(hex)}
                className={`h-6 rounded border transition-transform hover:scale-105 ${
                  value.toLowerCase() === hex ? 'border-amber-400 ring-1 ring-amber-400/60' : 'border-slate-700'
                }`}
                style={{ background: hex }}
              />
            ))}
            {/* Any colour at all. The input is transparent and stretched over
                the cell so the cell itself is the swatch: a bare
                `<input type="color">` renders as a chunky OS-styled button that
                sits nothing like the eleven beside it. */}
            <label
              title="Pick any colour"
              className="relative h-6 rounded border border-slate-700 overflow-hidden cursor-pointer transition-transform hover:scale-105"
              style={{
                background:
                  'conic-gradient(#ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)'
              }}
            >
              <span className="sr-only">{`${label}: pick any colour`}</span>
              <input
                type="color"
                value={normalizeHex(value) ?? '#ffffff'}
                onChange={e => applyPreset(e.target.value)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </label>
          </div>

          <label className="block">
            <span className="flex justify-between text-[11px] text-slate-400">
              <span>Hue</span>
              <span className="font-mono">{hsl.h}&deg;</span>
            </span>
            <input
              type="range"
              min={0}
              max={360}
              value={hsl.h}
              onChange={e => setChannel('h', parseInt(e.target.value, 10))}
              className={sliderClass}
            />
          </label>

          <label className="block">
            <span className="flex justify-between text-[11px] text-slate-400">
              <span>Saturation</span>
              <span className="font-mono">{hsl.s}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={hsl.s}
              onChange={e => setChannel('s', parseInt(e.target.value, 10))}
              className={sliderClass}
            />
          </label>

          <label className="block">
            <span className="flex justify-between text-[11px] text-slate-400">
              <span>Lightness</span>
              <span className="font-mono">{hsl.l}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={hsl.l}
              onChange={e => setChannel('l', parseInt(e.target.value, 10))}
              className={sliderClass}
            />
          </label>

          <input
            type="text"
            spellCheck={false}
            aria-label={`${label} hex value`}
            value={draft ?? value}
            onFocus={() => setDraft(value)}
            onChange={e => {
              setDraft(e.target.value);
              const hex = normalizeHex(e.target.value);
              if (hex) {
                setHsl(hexToHsl(hex));
                emit(hex);
              }
            }}
            onBlur={() => setDraft(null)}
            className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500/60 focus:outline-none rounded-lg px-2 py-1.5 text-[11px] text-slate-100 font-mono"
          />
        </div>
      )}
    </div>
  );
};
