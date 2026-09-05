'use client';

import { useEffect, useRef, useState } from 'react';
import { ProjectDraft, saveDraft } from '@/lib/draftStore';

/**
 * Writes the working project down shortly after it stops changing.
 *
 * Debounced rather than on a timer, so a draft is only written when there is
 * something new in it -- and `draft` must therefore be a value that keeps its
 * identity between edits, or a re-render per playback tick would reset the
 * delay forever and nothing would ever be saved.
 *
 * A storage refusal (quota, private mode) stops the attempts for the rest of
 * the session. Retrying every few seconds cannot succeed, and the failure is
 * not worth the work.
 */
export function useAutoSaveDraft(draft: ProjectDraft | null, delayMs = 2500): number | null {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const blocked = useRef(false);

  useEffect(() => {
    if (!draft || blocked.current) return;
    const timer = setTimeout(() => {
      const at = Date.now();
      if (saveDraft({ ...draft, savedAt: at }) === 'blocked') {
        blocked.current = true;
        return;
      }
      setSavedAt(at);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [draft, delayMs]);

  return savedAt;
}
