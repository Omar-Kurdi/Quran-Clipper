'use client';

import React from 'react';
import { lengthFits } from '@/lib/exportPresets';
import { formatClipLength } from '@/lib/mediaDuration';
import { formatDuration } from './AudioTrimModal';
import { useT } from './LocaleProvider';

/**
 * The clip's length as it will export, against each platform's limit: Shorts,
 * TikTok and Reels, green while it fits and red once it is over, the full list
 * of platforms on hover. Follows the clip as its ends are moved.
 */
export const LengthReadout: React.FC<{ seconds: number }> = ({ seconds }) => {
  const t = useT();
  if (!(seconds > 0)) return null;
  const fits = lengthFits(seconds);
  const title = [
    t.lengthReadout.title(formatDuration(seconds)),
    ...fits.flatMap(fit => fit.presetIds.map(id => {
      const name = t.exportModal.presets[id as keyof typeof t.exportModal.presets] ?? id;
      return fit.fits ? t.lengthReadout.fits(name, formatClipLength(fit.maxSeconds)) : t.lengthReadout.over(name, formatClipLength(fit.maxSeconds));
    }))
  ].join('\n');
  return (
    <span title={title} className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] rounded-lg border border-slate-700 text-slate-300 select-none">
      <span className="font-mono text-slate-100" dir="ltr">{formatDuration(seconds)}</span>
      {fits.map(fit => (
        <span
          key={fit.id}
          className={`rounded px-1 font-semibold ${fit.fits ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/20 text-red-300 line-through'}`}
        >
          {t.lengthReadout.short[fit.id as keyof typeof t.lengthReadout.short] ?? fit.id}
        </span>
      ))}
    </span>
  );
};
