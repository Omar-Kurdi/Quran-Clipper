'use client';

import { useRef, useState } from 'react';
import type { VerseData } from '@/lib/quranData';
import type { ScreenBreaks } from '@/lib/forcedAligner';

/** What a re-cut needs to know about the match it re-cuts. */
export interface HeldMatch {
  /** The sidecar's id for the alignment; see `/api/audio/regroup`. */
  id: string;
  /** The audio it was matched against. Any other audio -- a trim, a new upload -- retires it. */
  audioUrl: string;
  /** The captions as the match left them, to tell whether they have been edited since. */
  verses: VerseData[];
  provider: string;
  surah: number;
  start: number;
  end: number;
  audioDuration: number;
}

/** The studio's answer to a match or a re-cut, as `/api/audio/match` sends it. */
export type MatchData = { verses?: VerseData[]; regroupId?: string | null } & Record<string, unknown>;

type Outcome = { ok: true; data: MatchData } | { ok: false; expired: boolean; error: string };

/** The question `/api/audio/regroup` is asked: which match, at which setting, and what it covers. */
function regroupQuery(held: HeldMatch, breaks: ScreenBreaks): URLSearchParams {
  return new URLSearchParams({
    id: held.id,
    breaks,
    provider: held.provider,
    surah: String(held.surah),
    start: String(held.start),
    end: String(held.end),
    audioDuration: String(held.audioDuration)
  });
}

/**
 * Fewer / More applied to the match on screen, without matching again.
 *
 * Nothing here is saved -- not in a draft, not in a project -- because the
 * sidecar only holds a match for a while, and an id that outlived it would
 * offer a re-cut that cannot happen.
 */
export function useRegroup() {
  const [held, setHeld] = useState<HeldMatch | null>(null);
  const [busy, setBusy] = useState(false);
  // Only the newest request may land: Fewer then More in quick succession
  // must end on More, whichever answer arrives first.
  const latest = useRef(0);

  /** Called with every match the studio applies; one without an id forgets the last. */
  const remember = (data: MatchData, context: Omit<HeldMatch, 'id' | 'verses'>) => {
    setHeld(data.regroupId && data.verses ? { ...context, id: data.regroupId, verses: data.verses } : null);
  };

  /** After a re-cut: the new captions are the unedited ones now. */
  const recutApplied = (data: MatchData) => {
    setHeld(previous => (previous && data.verses ? { ...previous, verses: data.verses } : previous));
  };

  /** Whether the match on screen can be re-cut: it came from the aligner, over this same audio. */
  const available = (audioUrl: string) => Boolean(held && held.audioUrl === audioUrl);

  /** Whether the captions have changed since the match or re-cut that made them. */
  const edited = (verses: VerseData[]) => Boolean(held && verses !== held.verses);

  const recut = async (breaks: ScreenBreaks): Promise<Outcome | null> => {
    if (!held) return null;
    const request = ++latest.current;
    setBusy(true);
    try {
      const res = await fetch(`/api/audio/regroup?${regroupQuery(held, breaks)}`);
      const data = await res.json().catch(() => ({}));
      if (request !== latest.current) return null;
      if (res.ok && data.success) return { ok: true, data };
      if (res.status === 410) setHeld(null);
      return { ok: false, expired: res.status === 410, error: data.error || res.statusText };
    } catch (err) {
      return request === latest.current ? { ok: false, expired: false, error: (err as Error).message } : null;
    } finally {
      if (request === latest.current) setBusy(false);
    }
  };

  return { held, busy, remember, recutApplied, available, edited, recut };
}
