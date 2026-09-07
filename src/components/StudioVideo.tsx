'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { useVolume, volumePreference } from '@/hooks/useVolume';

/**
 * A `<video>` that plays at the studio's volume.
 *
 * `volume` is not something React writes for you -- it is a property, not an
 * attribute -- so a plain `<video>` always starts at full whatever the rest of
 * the studio is set to. That is most noticeable on the export screen, where a
 * preview begins playing the moment it is ready.
 *
 * Set in the ref callback as well as in an effect: the callback runs before
 * the element can start playing, so an autoplaying preview is never briefly
 * loud on the way to being correct. The effect is what follows a later change
 * -- the slider moving, or another tab.
 */
export const StudioVideo: React.FC<React.VideoHTMLAttributes<HTMLVideoElement>> = props => {
  const volume = useVolume();
  const elementRef = useRef<HTMLVideoElement | null>(null);

  const attach = useCallback((element: HTMLVideoElement | null) => {
    elementRef.current = element;
    if (element) element.volume = volumePreference.get();
  }, []);

  useEffect(() => {
    if (elementRef.current) elementRef.current.volume = volume;
  }, [volume]);

  return <video ref={attach} {...props} />;
};
