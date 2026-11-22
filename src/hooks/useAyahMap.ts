'use client';

import { useRef, useState } from 'react';
import { postClipMatch } from '@/lib/clipMatch';
import { mergeIntoGaps, planMapWindows, windowsToMatch, type Stretch } from '@/lib/ayahMap';
import type { Pause } from '@/lib/pauses';
import type { VerseData } from '@/lib/quranData';

/** What mapping a recording needs from the studio, read when it starts. */
export interface MapRun {
  file: File;
  /** The server's copy of the recording (`readLong`): its id, and its length, the clock the map is on. */
  long: { id: string; duration: number };
  pauses: readonly Pause[];
  /** The captions the recording has already: kept as they are, and the stretches they cover not matched again. */
  seed: VerseData[];
  /** The surah the recording is, and its ayahs, which every stretch is matched against. */
  surah: number;
  ayahs: number;
  reciter: string;
  provider: string;
  breaks?: string;
  /** Whether the recording being mapped is still the one open: mapping stops when it is not. */
  stillOpen: () => boolean;
  /** The map so far, after each stretch: shown and saved, so a run stopped part-way resumes from there. */
  onProgress: (map: VerseData[]) => Promise<void>;
  /** How far it has got, in stretches, said before the first and after each. */
  onStep: (done: number, total: number) => void;
}

/**
 * Maps a long recording (`ayahMap.ts`): each stretch not captioned yet
 * matched in turn -- one at a time, as the aligner takes no more than two
 * from one visitor -- and merged into the gaps of the map. A stretch that
 * fails stops the run where it was; `running` while one goes on.
 */
export function useAyahMap() {
  const [running, setRunning] = useState(false);
  const busy = useRef(false);

  const matchStretch = async (run: MapRun, window: Stretch): Promise<VerseData[]> => {
    const res = await postClipMatch({
      file: run.file, sourceId: run.long.id, clip: window, surah: run.surah, start: 1, end: run.ayahs,
      reciter: run.reciter, provider: run.provider, breaks: run.breaks,
    }, form => fetch('/api/audio/match', { method: 'POST', body: form }));
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
    return (data.verses || []) as VerseData[];
  };

  /** Maps what is left of the recording: the map, or null with why when it stopped first. */
  const start = async (run: MapRun): Promise<{ map: VerseData[] | null; error?: string }> => {
    if (busy.current) return { map: null };
    busy.current = true;
    setRunning(true);
    const windows = windowsToMatch(planMapWindows(run.long.duration, run.pauses), run.seed);
    run.onStep(0, windows.length);
    try {
      // One stretch after another, each against the map the last one left; null once the recording is closed.
      const map = await windows.reduce<Promise<VerseData[] | null>>(async (pending, window, i) => {
        const sofar = await pending;
        if (!sofar || !run.stillOpen()) return null;
        const next = mergeIntoGaps(sofar, await matchStretch(run, window));
        if (!run.stillOpen()) return null;
        await run.onProgress(next);
        run.onStep(i + 1, windows.length);
        return next;
      }, Promise.resolve(run.seed));
      return { map };
    } catch (err) {
      return { map: null, error: (err as Error).message };
    } finally {
      busy.current = false;
      setRunning(false);
    }
  };

  return { start, running };
}
