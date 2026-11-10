import { describe, it, expect, vi } from 'vitest';
import { authorizeUrl, exchangeCode, freshHeld, sealHeld, tiktokClient, unsealHeld, type Held } from './tiktokVault';
import { seal } from './youtubeVault';

const client = { key: 'ck', secret: 'shh' };
const answer = (body: unknown) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 200 }));

describe('tiktokClient', () => {
  it('is offered only with both the key and the secret', () => {
    expect(tiktokClient({ TIKTOK_CLIENT_KEY: 'k', TIKTOK_CLIENT_SECRET: 's' })).toEqual({ key: 'k', secret: 's' });
    expect(tiktokClient({ TIKTOK_CLIENT_KEY: 'k' })).toBeNull();
    expect(tiktokClient({})).toBeNull();
  });
});

describe('authorizeUrl', () => {
  it('asks TikTok for the profile and upload permissions, back to the studio with the state', () => {
    const url = new URL(authorizeUrl(client, 'https://studio.example/api/tiktok/callback', 'abc'));
    expect(url.origin + url.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_key: 'ck', response_type: 'code', scope: 'user.info.basic,video.upload',
      redirect_uri: 'https://studio.example/api/tiktok/callback', state: 'abc'
    });
  });
});

describe('sealing the tokens', () => {
  const held: Held = { refresh: 'r1', access: 'a1', until: 1000 };

  it('opens what it sealed, and nothing sealed under another secret', () => {
    const sealed = sealHeld(held, 'shh');
    expect(unsealHeld(sealed, 'shh')).toEqual(held);
    expect(unsealHeld(sealed, 'other')).toBeNull();
    expect(unsealHeld(undefined, 'shh')).toBeNull();
  });

  it('does not open a YouTube cookie sealed under the same secret', () => {
    expect(unsealHeld(seal(JSON.stringify(held), 'shh'), 'shh')).toBeNull();
  });
});

describe('exchangeCode', () => {
  it('keeps both tokens, the access token until it runs out', async () => {
    const fetcher = answer({ access_token: 'a', refresh_token: 'r', expires_in: 7200, refresh_expires_in: 1000, scope: 'user.info.basic,video.upload' });
    const grant = await exchangeCode('code', client, 'https://x/cb', fetcher, 0);
    expect(grant).toEqual({ ok: true, held: { refresh: 'r', access: 'a', until: 7_200_000 }, keepFor: 1000 });
    const body = fetcher.mock.calls[0][1]?.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(Object.fromEntries(body as URLSearchParams)).toEqual({
      client_key: 'ck', client_secret: 'shh', code: 'code', grant_type: 'authorization_code', redirect_uri: 'https://x/cb'
    });
  });

  it('refuses a grant without the upload permission', async () => {
    const grant = await exchangeCode('code', client, 'https://x/cb', answer({ access_token: 'a', refresh_token: 'r', scope: 'user.info.basic' }));
    expect(grant).toEqual({ ok: false, reason: 'scope' });
  });
});

describe('freshHeld', () => {
  it('uses the access token while it has more than a few minutes left', async () => {
    const fetcher = answer({});
    const held = { refresh: 'r', access: 'a', until: 10 * 60_000 };
    expect(await freshHeld(held, client, fetcher, 0)).toEqual({ ok: true, held });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refreshes one about to run out, keeping the new refresh token TikTok hands back', async () => {
    const fetcher = answer({ access_token: 'a2', refresh_token: 'r2', expires_in: 60, scope: 'video.upload' });
    const grant = await freshHeld({ refresh: 'r', access: 'a', until: 60_000 }, client, fetcher, 0);
    expect(grant).toMatchObject({ ok: true, held: { refresh: 'r2', access: 'a2', until: 60_000 } });
  });

  it('says a refresh token TikTok no longer honours is revoked', async () => {
    const grant = await freshHeld({ refresh: 'r', access: 'a', until: 0 }, client, answer({ error: 'invalid_grant' }), 0);
    expect(grant).toEqual({ ok: false, reason: 'revoked' });
  });
});
