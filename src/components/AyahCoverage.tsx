'use client';

import React from 'react';
import { clipColour } from '@/lib/clipColours';
import { useT } from './LocaleProvider';

/**
 * Which ayahs of a recording are in a clip already: a strip with a cell per
 * ayah, in the colour of the first clip that holds it and empty otherwise,
 * its first and last ayah under it and how many are clipped.
 */
export const AyahCoverage: React.FC<{ ayahs: { key: string; clips: number[] }[] }> = ({ ayahs }) => {
  const t = useT();
  if (!ayahs.length) return null;
  const clipped = ayahs.filter(ayah => ayah.clips.length > 0).length;
  return (
    <div>
      <div className="flex h-3 rounded overflow-hidden border border-slate-800 bg-slate-900" dir="ltr" role="img" aria-label={t.clips.coverage(clipped, ayahs.length)}>
        {ayahs.map(ayah => (
          <span
            key={ayah.key}
            title={ayah.clips.length ? `${ayah.key} · ${ayah.clips.map(i => t.clips.name(i + 1)).join(', ')}` : ayah.key}
            className={`flex-1 min-w-px ${ayah.clips.length ? clipColour(ayah.clips[0]).dot : ''}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between gap-2 font-mono text-[10px] text-slate-400" dir="ltr">
        <span>{ayahs[0].key}</span>
        <span className="font-sans text-slate-300">{t.clips.coverage(clipped, ayahs.length)}</span>
        <span>{ayahs[ayahs.length - 1].key}</span>
      </div>
    </div>
  );
};
