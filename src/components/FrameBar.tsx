'use client';

import React from 'react';
import { EXPORT_PRESETS } from '@/lib/exportPresets';
import { coveredAreas, framePreset, type FrameArea } from '@/lib/frame';
import { ASPECT_RATIOS } from '@/lib/quranData';
import { useT } from './LocaleProvider';

interface FrameBarProps {
  aspectRatio: string;
  /** Index into `EXPORT_PRESETS` of the platform last chosen. */
  chosenIndex: number;
  onChoose: (index: number) => void;
  safeArea: boolean;
  onSafeArea: (show: boolean) => void;
}

/**
 * The frame shape, chosen above the preview where its effect is seen, as a
 * platform rather than a bare ratio -- the same setting Export opens on. It
 * used to be set twice, once in Style and again by Export's platform buttons,
 * and the two could disagree.
 */
export const FrameBar: React.FC<FrameBarProps> = ({ aspectRatio, chosenIndex, onChoose, safeArea, onSafeArea }) => {
  const t = useT();
  const preset = framePreset(chosenIndex, aspectRatio);
  const size = ASPECT_RATIOS.find(ar => ar.id === aspectRatio);
  return (
    <div className="w-full shrink-0 flex flex-wrap items-center gap-x-4 gap-y-2 px-1 pb-3">
      <label className="flex items-center gap-2 text-[13px] text-slate-400">
        {t.frame.label}
        <select
          value={EXPORT_PRESETS.indexOf(preset)}
          onChange={e => onChoose(Number(e.target.value))}
          className="h-9 rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-[13px] font-semibold text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          {EXPORT_PRESETS.map((p, i) => (
            <option key={p.id} value={i}>
              {t.exportModal.presets[p.id as keyof typeof t.exportModal.presets]} · {p.aspectRatio}
            </option>
          ))}
        </select>
      </label>
      {coveredAreas(preset.id).length > 0 && (
        <label className="flex items-center gap-2 text-[13px] text-slate-300 cursor-pointer">
          <input type="checkbox" checked={safeArea} onChange={e => onSafeArea(e.target.checked)} className="w-4 h-4 accent-amber-500" />
          {t.frame.safeArea}
        </label>
      )}
      <span className="ms-auto font-mono text-xs text-slate-400" dir="ltr">
        {size ? `${size.width} × ${size.height}` : aspectRatio}
      </span>
    </div>
  );
};

/**
 * Dashed outlines over the preview where the platform draws its own buttons
 * and caption. A DOM layer over the canvas, never drawn into it, so nothing
 * here can reach an export.
 */
export const SafeAreaOverlay: React.FC<{ areas: FrameArea[]; platform: string }> = ({ areas, platform }) => {
  const t = useT();
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {areas.map((area, i) => (
        <div
          key={i}
          className="absolute border border-dashed border-amber-400/80 bg-amber-400/5 rounded-sm"
          style={{ top: `${area.top}%`, left: `${area.left}%`, width: `${area.width}%`, height: `${area.height}%` }}
        >
          {i === 1 && <span className="absolute top-1 start-1.5 text-[10px] font-semibold text-amber-300">{t.frame.covered(platform)}</span>}
        </div>
      ))}
    </div>
  );
};
