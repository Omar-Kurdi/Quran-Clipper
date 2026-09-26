'use client';

import { useEffect, useState } from 'react';
import type { StudioMode } from '@/lib/studioMode';

export interface StudioConfig {
  mode: StudioMode;
  /** Arabic faces whose files are not on this server, and `surah-name` when the badge face is not. */
  missingFonts: ReadonlySet<string>;
}

/**
 * Until the answer arrives, nothing is assumed missing: on a machine that has
 * the fonts -- the usual case -- guessing otherwise would flash every caption
 * through the fallback face on each page load.
 */
const UNKNOWN: StudioConfig = { mode: 'personal', missingFonts: new Set() };

// One request per page, shared by every component that asks.
let pending: Promise<StudioConfig> | null = null;

function load(): Promise<StudioConfig> {
  pending ??= fetch('/api/studio')
    .then(res => (res.ok ? res.json() : null))
    .then((body: { mode?: StudioMode; missingFonts?: string[] } | null) => ({
      mode: body?.mode === 'public' ? 'public' as const : 'personal' as const,
      missingFonts: new Set(body?.missingFonts ?? []),
    }))
    .catch(() => UNKNOWN);
  return pending;
}

export function useStudioConfig(): StudioConfig {
  const [config, setConfig] = useState<StudioConfig>(UNKNOWN);
  useEffect(() => {
    let live = true;
    void load().then(next => { if (live) setConfig(next); });
    return () => { live = false; };
  }, []);
  return config;
}
