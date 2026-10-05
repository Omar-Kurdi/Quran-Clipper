/**
 * Uploading a finished clip to the user's own YouTube channel, from the tab.
 *
 * The person signs in to Google in a pop-up and the studio gets a short-lived
 * token for `youtube.upload` and nothing else. The token lives in this tab only:
 * no studio account, nothing stored, nothing sent to our server -- the video
 * goes from the browser straight to Google (FutureIdeas #59).
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

/** What YouTube is told about the video before the file goes. */
export function videoResource(meta: Pick<PublishMetadata, 'title' | 'description' | 'tags'>, privacy: Privacy) {
  return {
    snippet: {
      title: meta.title.slice(0, TITLE_MAX),
      description: meta.description.slice(0, DESCRIPTION_MAX),
      tags: fitTags(meta.tags),
      // Education: what a recitation with its translation is.
      categoryId: '27'
    },
    status: {
      privacyStatus: privacy,
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
export async function startUpload(token: string, meta: Pick<PublishMetadata, 'title' | 'description' | 'tags'>, privacy: Privacy, file: Blob): Promise<string> {
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
      body: JSON.stringify(videoResource(meta, privacy))
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
