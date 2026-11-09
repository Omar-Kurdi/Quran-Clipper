// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { sidecarRequest } from './sidecarRequest';

let server: http.Server | null = null;

/** A sidecar stand-in on a free port; `handle` answers each request. */
async function serve(handle: http.RequestListener): Promise<string> {
  server = http.createServer(handle);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await new Promise(resolve => (server ? server.close(resolve) : resolve(undefined)));
  server = null;
});

describe('sidecarRequest', () => {
  it('posts the form as multipart, as fetch would', async () => {
    const base = await serve((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ type: req.headers['content-type'], hasField: body.includes('name="breaks"') && body.includes('fewer') }));
      });
    });
    const form = new FormData();
    form.append('breaks', 'fewer');
    const res = await sidecarRequest(`${base}/align`, form);
    const answer = await res.json();
    expect(res.ok).toBe(true);
    expect(answer.type).toMatch(/^multipart\/form-data; boundary=/);
    expect(answer.hasField).toBe(true);
  });

  it('passes on an error answer with its status', async () => {
    const base = await serve((_req, res) => {
      res.statusCode = 422;
      res.end(JSON.stringify({ detail: 'no passage' }));
    });
    const res = await sidecarRequest(`${base}/regroup?id=x`);
    expect(res.status).toBe(422);
    expect(await res.text()).toContain('no passage');
  });

  it('waits for a slow answer up to its limit, and no further', async () => {
    const base = await serve((_req, res) => { setTimeout(() => res.end('done'), 150); });
    expect(await (await sidecarRequest(base, undefined, 1000)).text()).toBe('done');
    await expect(sidecarRequest(base, undefined, 50)).rejects.toThrow(/no answer within/);
  });
});
