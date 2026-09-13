import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

/**
 * The gate in front of the whole studio.
 *
 * Everything here goes through the exported `middleware`, because the
 * comparison it relies on is private -- which is the right way round: what
 * matters is what a request gets back, not how the check is spelled.
 *
 * `STUDIO_TOKEN` is read at call time rather than at import, so each test sets
 * it and the teardown restores whatever was there. A test that leaked the
 * variable would turn every later "nothing configured" case into a silent pass.
 *
 * The groups below are kept short deliberately: one long `describe` is one
 * long function, and the quality gate counts it as such.
 */
const TOKEN = 'secret-token-value';
const COOKIE = 'studio_token';

const request = (url: string, init?: RequestInit) => new NextRequest(new Request(url, init));
const withToken = () => {
  process.env.STUDIO_TOKEN = TOKEN;
};

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.STUDIO_TOKEN;
  delete process.env.STUDIO_TOKEN;
});
afterEach(() => {
  if (saved === undefined) delete process.env.STUDIO_TOKEN;
  else process.env.STUDIO_TOKEN = saved;
});

// The studio is a tool on your own machine by default. If configuring nothing
// started demanding a secret, the gate would have broken the only way the app
// is normally used.
describe('gate with no STUDIO_TOKEN configured', () => {
  it('lets a page through', () => {
    expect(middleware(request('http://localhost:3000/video-creator')).status).toBe(200);
  });

  it('leaves even the routes worth protecting open', () => {
    expect(middleware(request('http://localhost:3000/api/projects')).status).toBe(200);
  });
});

describe('gate with STUDIO_TOKEN configured', () => {
  beforeEach(withToken);

  it('refuses a request carrying nothing, and says how to get in', async () => {
    const res = middleware(request('http://localhost:3000/api/projects'));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toContain('?token=');
  });

  // An uptime check should not need the secret, and health reports only whether
  // services answer -- never anything a project contains.
  it('still answers /api/health', () => {
    expect(middleware(request('http://localhost:3000/api/health')).status).toBe(200);
  });
});

describe('exchanging ?token= for a cookie', () => {
  beforeEach(withToken);

  it('redirects, and the token does not survive into the new URL', () => {
    const res = middleware(request(`http://localhost:3000/video-creator?token=${TOKEN}`));
    expect(res.status).toBe(307);
    // The whole point: nothing left in history, in a bookmark, or in the
    // referrer of every outbound link on the page.
    expect(res.headers.get('location')).not.toContain('token');
  });

  it('keeps the rest of the query string', () => {
    const res = middleware(request(`http://localhost:3000/video-creator?surah=21&token=${TOKEN}`));
    expect(res.headers.get('location')).toContain('surah=21');
  });

  it('refuses a wrong ?token= and hands out no cookie', () => {
    const res = middleware(request('http://localhost:3000/x?token=not-the-token'));
    expect(res.status).toBe(401);
    expect(res.cookies.get(COOKIE)).toBeUndefined();
  });
});

describe('the cookie the exchange sets', () => {
  beforeEach(withToken);

  it('cannot be read by the page itself, and lasts a month', () => {
    const cookie = middleware(request(`http://localhost:3000/x?token=${TOKEN}`)).cookies.get(COOKIE);
    expect(cookie?.value).toBe(TOKEN);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
    expect(cookie?.maxAge).toBe(60 * 60 * 24 * 30);
  });

  // `secure` is derived from the request rather than hardcoded: a secure cookie
  // is never sent back over http, so pinning it on would lock out the local
  // http use the studio is normally run as.
  it('is secure only when the request was', () => {
    const https = middleware(request(`https://studio.example/x?token=${TOKEN}`));
    const http = middleware(request(`http://localhost:3000/x?token=${TOKEN}`));
    expect(https.cookies.get(COOKIE)?.secure).toBe(true);
    expect(http.cookies.get(COOKIE)?.secure).toBe(false);
  });
});

describe('presenting a credential', () => {
  beforeEach(withToken);
  const to = (headers: Record<string, string>) =>
    middleware(request('http://localhost:3000/api/projects', { headers }));

  it('accepts a bearer header', () => {
    expect(to({ authorization: `Bearer ${TOKEN}` }).status).toBe(200);
  });

  it('accepts the cookie the redirect set', () => {
    expect(to({ cookie: `${COOKIE}=${TOKEN}` }).status).toBe(200);
  });

  // A stale cookie should not veto a caller holding the real token -- scripts
  // send a header, browsers send the cookie, and a rotated token arrives in the
  // header first.
  it('takes the bearer header over a stale cookie', () => {
    expect(to({ authorization: `Bearer ${TOKEN}`, cookie: `${COOKIE}=an-old-token` }).status).toBe(200);
  });

  it('refuses a bad cookie', () => {
    expect(to({ cookie: `${COOKIE}=not-the-token` }).status).toBe(401);
  });
});

// The two properties the hand-written comparison exists for. Swapping it for
// `startsWith` passes every test above and fails the first of these.
describe('the comparison itself', () => {
  beforeEach(withToken);
  const bearer = (token: string) =>
    middleware(request('http://localhost:3000/x', { headers: { authorization: `Bearer ${token}` } }));

  it('refuses a token that is merely a prefix of the real one', () => {
    expect(bearer('secret-token').status).toBe(401);
  });

  it('refuses a token of the right length but the wrong content', () => {
    const wrong = 'secret-token-valux';
    expect(wrong).toHaveLength(TOKEN.length);
    expect(bearer(wrong).status).toBe(401);
  });
});
