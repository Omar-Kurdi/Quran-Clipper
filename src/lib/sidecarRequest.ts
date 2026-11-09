/**
 * A request to the alignment sidecar that waits as long as a match takes.
 *
 * Node's `fetch` gives up on any answer that takes more than five minutes to
 * start (undici's `headersTimeout`), and it has no option to wait longer
 * without the `undici` package itself. A match is one answer, sent when the
 * whole recording is done: thirteen minutes of Al-Baqarah took 7 min 50 s, so
 * the studio said the aligner could not be reached while it was still working,
 * and threw the result away when it came. `node:http` has no such limit, so
 * this sets its own, far past any match.
 */

import http from 'node:http';
import https from 'node:https';

/** Longer than any match: the aligner takes about 45 minutes of audio, and minutes per minute of it at worst. */
export const SIDECAR_WAIT_MS = 30 * 60 * 1000;

/** GET `url`, or POST `form` to it, and the answer as a `Response`. */
export async function sidecarRequest(url: string, form?: FormData, waitMs = SIDECAR_WAIT_MS): Promise<Response> {
  // Encoded by the platform, so the multipart body and its boundary are what fetch would have sent.
  const encoded = form ? new Request(url, { method: 'POST', body: form }) : null;
  const body = encoded ? Buffer.from(await encoded.arrayBuffer()) : null;
  const headers: Record<string, string | number> = {};
  if (encoded && body) {
    headers['content-type'] = encoded.headers.get('content-type') ?? 'application/octet-stream';
    headers['content-length'] = body.length;
  }
  const client = new URL(url).protocol === 'https:' ? https : http;
  return new Promise<Response>((resolve, reject) => {
    const req = client.request(url, { method: body ? 'POST' : 'GET', headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const answer = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (typeof value === 'string') answer.set(name, value);
        }
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 502, statusText: res.statusMessage, headers: answer }));
      });
    });
    // The socket's idle time: nothing arrives while the sidecar works, so this is the wait for its answer.
    req.setTimeout(waitMs, () => req.destroy(new Error(`no answer within ${Math.round(waitMs / 1000)} s`)));
    req.on('error', reject);
    req.end(body ?? undefined);
  });
}
