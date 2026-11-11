'use client';

import { useSyncExternalStore } from 'react';

/** Tailwind's `lg`: where the studio sets the panel beside the preview, with its rail. */
const WIDE = '(min-width: 1024px)';

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

/** Whether the studio is laid out for a desktop. False on the server and on a phone. */
export function useWideLayout(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches, () => false);
}
