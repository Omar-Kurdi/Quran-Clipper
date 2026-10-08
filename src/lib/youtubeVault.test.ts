import { describe, it, expect, vi } from 'vitest';
import { exchangeCode, fromStudio, refreshAccess, revoke, seal, unseal, vaultClient } from './youtubeVault';

const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const client = { id: 'client.apps.googleusercontent.com', secret: 'shh' };
const answer = (status: number, body: unknown): typeof fetch => async () => new Response(JSON.stringify(body), { status });
const unreachable: typeof fetch = async () => { throw new Error('offline'); };

describe('seal and unseal', () => {
  it('gives back the refresh token sealed with the same secret', () => {
    expect(unseal(seal('1//refresh', 'shh'), 'shh')).toBe('1//refresh');
  });

  it('seals the same token differently every time', () => {
    expect(seal('1//refresh', 'shh')).not.toBe(seal('1//refresh', 'shh'));
  });

  it('refuses a cookie tampered with, sealed under another secret, or not sealed at all', () => {
    const sealed = seal('1//refresh', 'shh');
    const flipped = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'B' : 'A') + sealed.slice(-1);
    expect(unseal(flipped, 'shh')).toBeNull();
    expect(unseal(sealed, 'other')).toBeNull();
    expect(unseal('1//refresh', 'shh')).toBeNull();
    expect(unseal(undefined, 'shh')).toBeNull();
  });
});

describe('vaultClient', () => {
  it('is offered only with both the client id and its secret', () => {
    expect(vaultClient({ NEXT_PUBLIC_YOUTUBE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' })).toEqual({ id: 'id', secret: 's' });
    expect(vaultClient({ NEXT_PUBLIC_YOUTUBE_CLIENT_ID: 'id' })).toBeNull();
    expect(vaultClient({ GOOGLE_CLIENT_SECRET: 's' })).toBeNull();
  });
});

describe('exchangeCode', () => {
  it('keeps the refresh token Google gives on consent', async () => {
    const grant = await exchangeCode('code', client, SCOPE, answer(200, { access_token: 'a', expires_in: 3599, refresh_token: 'r', scope: SCOPE }));
    expect(grant).toEqual({ ok: true, accessToken: 'a', expiresIn: 3599, refreshToken: 'r' });
  });

  it('says so when Google gives no refresh token, rather than keeping nothing', async () => {
    const grant = await exchangeCode('code', client, SCOPE, answer(200, { access_token: 'a', scope: SCOPE }));
    expect(grant).toEqual({ ok: false, reason: 'no-refresh' });
  });

  it('refuses a grant without the upload permission, which a person can untick', async () => {
    const grant = await exchangeCode('code', client, SCOPE, answer(200, { access_token: 'a', refresh_token: 'r', scope: 'openid' }));
    expect(grant).toEqual({ ok: false, reason: 'scope' });
  });
});

describe('refreshAccess', () => {
  it('turns the refresh token into a fresh access token', async () => {
    expect(await refreshAccess('r', client, answer(200, { access_token: 'a2', expires_in: 3599 }))).toEqual({ ok: true, accessToken: 'a2', expiresIn: 3599 });
  });

  it('tells a refresh token Google no longer honours from a failure that may pass', async () => {
    expect(await refreshAccess('r', client, answer(400, { error: 'invalid_grant' }))).toEqual({ ok: false, reason: 'revoked' });
    expect(await refreshAccess('r', client, answer(500, {}))).toEqual({ ok: false, reason: 'failed' });
  });
});

describe('revoke', () => {
  it('does not throw when Google cannot be reached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(revoke('r', unreachable)).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });
});

describe('fromStudio', () => {
  const req = (method: string, headers: Record<string, string>) => ({ method, headers: new Headers(headers), nextUrl: { host: 'studio.example' } });

  it("takes a POST from the studio's own page", () => {
    expect(fromStudio(req('POST', { 'x-requested-with': 'quranclipper', origin: 'https://studio.example' }))).toBe(true);
    expect(fromStudio(req('POST', { 'x-requested-with': 'quranclipper' }))).toBe(true);
  });

  it('refuses another site, a request without the header, and anything but POST', () => {
    expect(fromStudio(req('POST', { 'x-requested-with': 'quranclipper', origin: 'https://evil.example' }))).toBe(false);
    expect(fromStudio(req('POST', { origin: 'https://studio.example' }))).toBe(false);
    expect(fromStudio(req('GET', { 'x-requested-with': 'quranclipper' }))).toBe(false);
  });
});
