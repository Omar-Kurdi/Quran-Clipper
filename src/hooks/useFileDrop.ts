'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Turns any element into a drop target for files.
 *
 * Both upload areas in the studio were already drawn as dashed drop zones --
 * they simply did not accept a drop, so the one gesture the shape invites did
 * nothing and the file picker was the only way in.
 *
 * Two details this exists to get right, both of which are easy to miss when
 * writing the handlers inline:
 *
 * `dragenter` and `dragleave` fire for every child element the pointer crosses,
 * not just the target, so a naive boolean flickers off the moment the cursor
 * passes over the icon inside the zone. The depth counter is what makes the
 * highlight follow the drag rather than the DOM.
 *
 * And `dragover` must call `preventDefault` on every tick, not once: without it
 * the browser treats the drop as navigation and opens the file, replacing the
 * studio with a video player and losing the project.
 */
export function useFileDrop(
  onFiles: (files: File[]) => void,
  /** Which files this zone takes. Anything else is ignored rather than refused loudly. */
  accepts: (file: File) => boolean = () => true
) {
  const [isOver, setIsOver] = useState(false);
  const depth = useRef(0);

  const reset = useCallback(() => {
    depth.current = 0;
    setIsOver(false);
  }, []);

  /** Dragging selected text or a link is not an upload, and must not light the zone up. */
  const carriesFiles = (event: React.DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');

  return {
    /** True while a file is over the zone, for the caller to draw. */
    isOver,
    dropHandlers: {
      onDragEnter: (event: React.DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setIsOver(true);
      },
      onDragOver: (event: React.DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave: (event: React.DragEvent) => {
        if (!carriesFiles(event)) return;
        depth.current -= 1;
        if (depth.current <= 0) reset();
      },
      onDrop: (event: React.DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        reset();
        const files = Array.from(event.dataTransfer.files).filter(accepts);
        if (files.length) onFiles(files);
      }
    }
  };
}
