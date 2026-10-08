'use client';

import { useEffect, useState } from 'react';
import { guideSeen, rememberGuideSeen } from '@/lib/guideSeen';

/**
 * The guided tour's open state: by itself once per language, after the
 * studio has painted, and whenever the menu asks for it.
 *
 * `ready` holds it back while something else needs the person first -- the
 * offer to restore a draft. Closing remembers it in the language it opened in
 * and the one it closed in, since a switch mid-guide re-reads it in the new one.
 */
export function useGuidedTour(locale: string, ready: boolean) {
  const [openedIn, setOpenedIn] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || guideSeen(locale)) return;
    const timer = window.setTimeout(() => setOpenedIn(open => open ?? locale), 800);
    return () => window.clearTimeout(timer);
  }, [locale, ready]);
  return {
    isOpen: openedIn !== null,
    open: () => setOpenedIn(locale),
    close: () => {
      if (openedIn) rememberGuideSeen(openedIn);
      rememberGuideSeen(locale);
      setOpenedIn(null);
    }
  };
}
