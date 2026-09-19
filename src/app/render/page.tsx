'use client';

import { useEffect, useRef, useState } from 'react';
import { VideoCanvas, type VideoCanvasRef } from '@/components/VideoCanvas';
import { describeError, loadRenderJob, reportRender, runRenderJob, ticketFromLocation } from '@/lib/renderPage';
import type { RenderSpec } from '@/lib/serverRender';

/**
 * The page a server render's headless browser opens.
 *
 * Not for people: the runner starts Chromium here with a job id and key, and
 * this draws that job with the studio's own `VideoCanvas` and encodes it with
 * the studio's own frame-by-frame exporter -- which is the whole point, since
 * the file then matches the preview by construction. See `lib/renderPage.ts`.
 */
export default function RenderPage() {
  const canvasRef = useRef<VideoCanvasRef | null>(null);
  const [spec, setSpec] = useState<RenderSpec | null>(null);
  // Once per page: development mounts effects twice, and a second render of
  // the same job would race the first to upload.
  const startedRef = useRef(false);

  useEffect(() => {
    const ticket = ticketFromLocation();
    loadRenderJob(ticket).then(setSpec, err => reportRender(ticket, { error: describeError(err) }));
  }, []);

  useEffect(() => {
    if (!spec || startedRef.current) return;
    startedRef.current = true;
    const ticket = ticketFromLocation();
    runRenderJob(ticket, spec, () => canvasRef.current)
      .catch(err => reportRender(ticket, { error: describeError(err) }));
  }, [spec]);

  if (!spec) return null;
  return (
    <div style={{ width: 540 }}>
      <VideoCanvas
        ref={canvasRef}
        config={spec.config}
        verses={spec.verses}
        currentTime={spec.range.start}
        surahNameArabic={spec.surahNameArabic}
        surahNameEnglish={spec.surahNameEnglish}
        reciterName={spec.reciterName}
        surahNumber={spec.surahNumber}
        ayahStart={spec.ayahStart}
        ayahEnd={spec.ayahEnd}
        syncBackgroundVideo={spec.syncBackgroundVideo}
        isPlaying={false}
        backgroundTimeOffset={spec.backgroundTimeOffset}
      />
    </div>
  );
}
