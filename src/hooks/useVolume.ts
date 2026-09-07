'use client';

import { useSyncExternalStore } from 'react';
import { createNumberPreference } from '@/lib/uiPreference';

/**
 * How loud the studio plays, remembered.
 *
 * Half, because the studio is used with headphones on and full is a startle
 * the first time a recitation begins. Kept across reloads, and shared by every
 * player: the timeline transport, the trim dialog and the export preview all
 * read this one value, so setting it once sets it everywhere.
 */
export const volumePreference = createNumberPreference('quranclipper.volume', 0.5, { min: 0, max: 1 });

export function useVolume(): number {
  return useSyncExternalStore(
    volumePreference.subscribe,
    volumePreference.get,
    volumePreference.getServerSnapshot
  );
}
