/**
 * What the server render page does, apart from mounting the canvas.
 *
 * Kept out of the page so the page is only the canvas: these read the job,
 * wait for what the first frame needs, run the studio's own frame-by-frame
 * exporter and hand the picture back. Every request goes to this job's worker
 * route with its id and key; see `app/api/render/worker`.
 */

import type { VideoCanvasRef } from '@/components/VideoCanvas';
import { decodeAudioFile } from './audioTrim';
import { rememberMediaKind } from './backgroundTimeline';
import { inputUrl, type RenderSpec } from './serverRender';

/** How long to wait for still backgrounds and fonts before rendering anyway. */
const READY_TIMEOUT_MS = 30_000;

export interface RenderTicket {
  id: string;
  key: string;
}

export function ticketFromLocation(): RenderTicket {
  const params = new URLSearchParams(window.location.search);
  return { id: params.get('id') || '', key: params.get('key') || '' };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Progress, or why the render cannot go on. Unanswered is fine: the runner notices silence. */
export function reportRender({ id, key }: RenderTicket, body: { progress?: number; error?: string }) {
  return fetch(`/api/render/worker?id=${id}&key=${key}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

export const describeError = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The job to draw, with its uploaded backgrounds' kinds registered. */
export async function loadRenderJob({ id, key }: RenderTicket): Promise<RenderSpec> {
  const data = await (await fetch(`/api/render/worker?id=${id}&key=${key}`)).json();
  if (!data.success) throw new Error(data.error || 'The render could not be read.');
  const spec = data.spec as RenderSpec;
  // Uploaded backgrounds arrive at urls that do not say what they are.
  for (const media of spec.media) rememberMediaKind(inputUrl(id, key, media.name), media.kind);
  return spec;
}

/** Resolves once `ready` holds, or at `deadline` regardless. */
async function until(ready: () => boolean, deadline: number): Promise<void> {
  if (ready() || Date.now() >= deadline) return;
  await sleep(200);
  return until(ready, deadline);
}

/** Fonts and still backgrounds, so the first frames are drawn with them. */
async function whenReady(canvas: () => VideoCanvasRef | null) {
  await document.fonts.ready;
  await until(() => canvas()?.backgroundsReady() ?? false, Date.now() + READY_TIMEOUT_MS);
  // One more frame of the preview loop, which is what asks for the page fonts.
  await sleep(500);
  await document.fonts.ready;
}

/** Renders the job and uploads the picture. The server adds the audio. */
export async function runRenderJob(ticket: RenderTicket, spec: RenderSpec, canvas: () => VideoCanvasRef | null) {
  const { id, key } = ticket;
  await whenReady(canvas);
  const audio = await decodeAudioFile(await (await fetch(`/api/render/worker?id=${id}&key=${key}&file=audio`)).blob());
  let lastReport = 0;
  const result = await canvas()?.exportVideoOffline(
    spec.range,
    audio,
    spec.plan.fps,
    fraction => {
      if (Date.now() - lastReport < 1000) return;
      lastReport = Date.now();
      void reportRender(ticket, { progress: fraction * 100 });
    },
    { width: spec.plan.width, height: spec.plan.height, bitrate: spec.plan.bitrate }
  );
  if (!result) throw new Error('This browser cannot encode frame by frame.');
  const upload = await fetch(`/api/render/worker?id=${id}&key=${key}`, { method: 'PUT', body: result.blob });
  if (!upload.ok) throw new Error(`The rendered picture could not be handed back (${upload.status}).`);
}
