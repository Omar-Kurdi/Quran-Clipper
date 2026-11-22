/**
 * Matching one clip of an upload on its own: a stretch of a long surah file,
 * cut on the server and aligned as that stretch (`uploadWindow.ts`), its
 * captions put in among the recording's others (`mergeWindowTimeline`).
 *
 * The request names the copy a personal studio keeps of a long upload
 * (`sourceId`) rather than sending two hours again for every clip; without
 * one -- a short upload, or the copy let go -- it sends the file.
 */

export interface ClipMatchRequest {
  file: File;
  /** The server's copy of the upload, when it keeps one. */
  sourceId?: string;
  clip: { start: number; end: number };
  surah: number;
  start: number;
  end: number;
  reciter: string;
  provider: string;
  breaks?: string;
  ticket?: string;
}

/** The match request for a clip; `withFile` sends the upload itself, as when the server's copy is gone. */
export function clipMatchForm(request: ClipMatchRequest, withFile: boolean): FormData {
  const form = new FormData();
  if (request.sourceId && !withFile) form.append('sourceId', request.sourceId);
  else form.append('audio', request.file);
  form.append('windowStart', String(request.clip.start));
  form.append('windowEnd', String(request.clip.end));
  form.append('surah', String(request.surah));
  form.append('start', String(request.start));
  form.append('end', String(request.end));
  form.append('reciter', request.reciter);
  form.append('provider', request.provider);
  if (request.breaks && request.breaks !== 'normal') form.append('breaks', request.breaks);
  if (request.ticket) form.append('ticket', request.ticket);
  return form;
}

/** Sends a clip's match, sending the file instead when the server no longer keeps its copy. */
export async function postClipMatch(request: ClipMatchRequest, post: (form: FormData) => Promise<Response>): Promise<Response> {
  const first = await post(clipMatchForm(request, false));
  return first.status === 404 && request.sourceId ? post(clipMatchForm(request, true)) : first;
}
