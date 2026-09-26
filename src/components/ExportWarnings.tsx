'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { backgroundLabel, type BackgroundSegment } from '@/lib/backgroundTimeline';
import { backgroundsIn, exportWarnings, probeBackground, type BackgroundRead } from '@/lib/exportWarnings';
import { useT } from './LocaleProvider';

export interface ExportLane {
  segments: BackgroundSegment[];
  /** Whether the lane was cut by hand; only then can it have gaps. */
  handCut: boolean;
  /** The render's range, on the same clock as the segments. */
  start: number;
  end: number;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;

/**
 * What the render is about to do that nobody would choose: paint the plain
 * gradient through a gap in the lane, or over a background it cannot read.
 * Said before the render rather than found in the file afterwards.
 */
export const ExportWarnings: React.FC<{ lane: ExportLane; offline: boolean }> = ({ lane, offline }) => {
  const t = useT();
  const [reads, setReads] = useState<Record<string, BackgroundRead>>({});

  const urls = useMemo(() => backgroundsIn(lane.segments, lane.start, lane.end), [lane]);
  useEffect(() => {
    let live = true;
    for (const url of urls) {
      void probeBackground(url).then(read => {
        if (live) setReads(current => (current[url] === read ? current : { ...current, [url]: read }));
      });
    }
    return () => { live = false; };
  }, [urls]);

  const warnings = exportWarnings({ ...lane, reads, offline });
  if (warnings.length === 0) return null;
  return (
    <div role="status" className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-[11px] leading-relaxed text-amber-200">
      <p className="font-semibold flex items-center gap-1.5 mb-1">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        {t.exportModal.warningsHeading}
      </p>
      <ul className="list-disc ps-5 space-y-0.5">
        {warnings.map(warning => (
          <li key={warning.kind === 'gap' ? `gap-${warning.start}` : `${warning.kind}-${warning.url}`}>
            {warning.kind === 'gap'
              ? t.exportModal.warnGap(clock(warning.start), clock(warning.end))
              : warning.kind === 'seeking'
                ? t.exportModal.warnSeeking(backgroundLabel(warning.url, t.backgrounds))
                : t.exportModal.warnUnreadable(backgroundLabel(warning.url, t.backgrounds))}
          </li>
        ))}
      </ul>
    </div>
  );
};
