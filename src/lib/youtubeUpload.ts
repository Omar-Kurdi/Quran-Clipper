/**
 * Uploading a finished clip to the user's own YouTube channel, from the tab.
 *
 * The person signs in to Google in a pop-up and the studio gets a short-lived
 * token for `youtube.upload` and nothing else, and the video goes from the
 * browser straight to Google (FutureIdeas #59). Where the server has the OAuth
 * client's secret, the sign-in is kept for that browser (`youtubeVault`);
 * otherwise the token lives in the browser for its hour, and nothing about it
 * reaches our server.
 *
 * The upload is YouTube's resumable protocol: one request that describes the
 * video and returns an upload address, then the file itself to that address.
 * Both answer cross-origin requests, which is what lets a page do this.
 *
 * Until the Google Cloud project is verified and passes YouTube's API audit,
 * YouTube keeps every video uploaded through it private, whatever was asked
 * for -- so the studio says so rather than letting "Public" look broken.
 */

import { TAGS_MAX, TITLE_MAX, DESCRIPTION_MAX, type PublishMetadata } from './publishMetadata';

export const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

export type Privacy = 'private' | 'unlisted' | 'public';

/** The OAuth client the studio signs in with, or '' when none is configured -- then nothing is offered. */
export const youtubeClientId = (): string => (process.env.NEXT_PUBLIC_YOUTUBE_CLIENT_ID || '').trim();

/** Tags cut to YouTube's limit on the whole list, commas included, keeping whole tags. */
function fitTags(tags: string[]): string[] {
  const kept: string[] = [];
  let length = 0;
  for (const tag of tags) {
    const next = length + (kept.length ? 1 : 0) + tag.length;
    if (next > TAGS_MAX) break;
    kept.push(tag);
    length = next;
  }
  return kept;
}

/**
 * When a scheduled upload goes public, from a `datetime-local` value -- which
 * is the person's own local time, with no zone in it.
 *
 * YouTube takes the moment as an ISO instant and refuses one in the past, so a
 * time already gone is said here instead of as a failed upload.
 */
export function scheduleTime(local: string, now: Date = new Date()): { publishAt: string } | 'past' | 'invalid' {
  const when = new Date(local);
  if (!local || Number.isNaN(when.getTime())) return 'invalid';
  if (when.getTime() <= now.getTime()) return 'past';
  return { publishAt: when.toISOString() };
}

/**
 * A sensible first offer for the schedule, as a `datetime-local` value: the
 * top of the hour after next, or with `atHour` the next time that hour comes
 * round -- today while it is still at least an hour off, else tomorrow.
 */
export function defaultScheduleValue(now: Date = new Date(), atHour?: number): string {
  const when = new Date(now);
  if (atHour === undefined) {
    when.setHours(when.getHours() + 2, 0, 0, 0);
  } else {
    when.setHours(atHour, 0, 0, 0);
    if (when.getTime() - now.getTime() < 60 * 60 * 1000) when.setDate(when.getDate() + 1);
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/**
 * What YouTube is told about the video before the file goes.
 *
 * A scheduled video is uploaded private with a `publishAt`, which is how
 * YouTube schedules: it turns public by itself at that moment. Like every
 * upload from an unaudited project it stays locked private until the audit
 * passes, so the schedule only takes effect after that.
 */
export function videoResource(meta: Pick<PublishMetadata, 'title' | 'description' | 'tags'>, privacy: Privacy, publishAt?: string) {
  return {
    snippet: {
      title: meta.title.slice(0, TITLE_MAX),
      description: meta.description.slice(0, DESCRIPTION_MAX),
      tags: fitTags(meta.tags),
      // Education: what a recitation with its translation is.
      categoryId: '27'
    },
    status: {
      privacyStatus: publishAt ? 'private' : privacy,
      ...(publishAt ? { publishAt } : {}),
      // Required on every upload. A recitation clip is not made for children
      // in COPPA's sense, which is about content directed at them.
      selfDeclaredMadeForKids: false
    }
  };
}

/** Why an upload failed, as something to say rather than a status code. */
export type UploadFailure = 'signin' | 'quota' | 'limit' | 'forbidden' | 'network' | 'other';

/** Reads Google's error body -- `{ error: { errors: [{ reason }] } }` -- into one of the failures above. */
export function uploadFailure(status: number, body: unknown): UploadFailure {
  const reasons = ((body as { error?: { errors?: { reason?: string }[] } })?.error?.errors ?? [])
    .map(e => e.reason ?? '');
  if (status === 401) return 'signin';
  if (reasons.some(r => r === 'quotaExceeded' || r === 'rateLimitExceeded' || r === 'dailyLimitExceeded')) return 'quota';
  if (reasons.includes('uploadLimitExceeded')) return 'limit';
  if (status === 403) return 'forbidden';
  if (status === 0) return 'network';
  return 'other';
}

export class UploadError extends Error {
  constructor(readonly failure: UploadFailure, detail: string) {
    super(detail);
    this.name = 'UploadError';
  }
}

/** A response body as JSON, or null for an empty or HTML answer -- which is then judged by its status alone. */
function parseJson(text: string): unknown {
  if (!text.trim().startsWith('{')) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    console.warn('[youtubeUpload] unreadable answer from YouTube:', (err as Error).message);
    return null;
  }
}

/** Asks YouTube for an upload address for this video. */
export async function startUpload(
  token: string, meta: Pick<PublishMetadata, 'title' | 'description' | 'tags'>, privacy: Privacy, file: Blob, publishAt?: string
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(UPLOAD_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': file.type || 'video/mp4',
        'X-Upload-Content-Length': String(file.size)
      },
      body: JSON.stringify(videoResource(meta, privacy, publishAt))
    });
  } catch (err) {
    throw new UploadError('network', (err as Error).message);
  }
  const location = res.headers.get('Location');
  if (!res.ok || !location) {
    const body = await res.json().catch(() => null);
    throw new UploadError(uploadFailure(res.status, body), `start: HTTP ${res.status}`);
  }
  return location;
}

/**
 * Sends the file to the upload address, reporting progress from 0 to 1.
 *
 * XHR rather than fetch: fetch has no upload progress, and a hundred-megabyte
 * 4K render with no sign of moving looks exactly like one that has stalled.
 */
export function sendVideo(location: string, file: Blob, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', location);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      const body = parseJson(xhr.responseText);
      const id = (body as { id?: string } | null)?.id;
      if (xhr.status >= 200 && xhr.status < 300 && id) resolve({ id });
      else reject(new UploadError(uploadFailure(xhr.status, body), `send: HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new UploadError('network', 'send: network error'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.onabort = () => reject(new DOMException('Upload cancelled.', 'AbortError'));
    xhr.send(file);
  });
}

/** Where the uploaded video can be seen and edited. */
export const studioLink = (id: string) => `https://studio.youtube.com/video/${encodeURIComponent(id)}/edit`;
export const watchLink = (id: string) => `https://youtu.be/${encodeURIComponent(id)}`;
