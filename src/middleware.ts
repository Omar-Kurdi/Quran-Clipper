import { NextRequest, NextResponse } from 'next/server';
import { studioMode, closedInPublicMode, publicPage } from '@/lib/studioMode';
import { STATS_COOKIE, tokenMatches } from '@/lib/exportCounts';

/**
 * A shared secret in front of the whole studio, for the day it is not local.
 *
 * As a tool on your own machine this app needs no authentication and has none.
 * The moment it is reachable by anyone else, though, `/api/projects` lets them
 * list and delete every saved project, `/api/audio/match` spends the Gemini
 * key, and `/api/background/resolve` spends the Pexels quota -- none of which
 * asks who is calling.
 *
 * So: set `STUDIO_TOKEN` and everything requires it. Leave it unset and this
 * is inert, which keeps local use exactly as it was. A gate nobody can forget
 * to apply is the point of putting it in middleware rather than in the routes
 * -- there is no per-route list to fall out of date, so a route added
 * tomorrow is covered by default rather than by remembering.
 *
 * This is a shared secret, not a login. It says whether the caller is *you*,
 * not which user they are, and it is exactly as strong as keeping the token
 * secret and serving over HTTPS. Multi-user hosting needs real accounts.
 */
const COOKIE = 'studio_token';

/** The same address without its `?token=`, setting the cookie that stands in for it from now on. */
function exchanged(req: NextRequest, name: string, value: string, path: string): NextResponse {
  const clean = req.nextUrl.clone();
  clean.searchParams.delete('token');
  const res = NextResponse.redirect(clean);
  res.cookies.set(name, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.nextUrl.protocol === 'https:',
    path,
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

export function middleware(req: NextRequest) {
  if (studioMode() === 'public' && closedInPublicMode(req.nextUrl.pathname)) {
    return NextResponse.json({ error: 'Not available on this public studio.' }, { status: 403 });
  }

  // The owner's export counts, `/stats`, open with their own token, the same
  // way as the studio's below: exchanged for a cookie and taken off the URL.
  const statsToken = req.nextUrl.pathname === '/stats' ? req.nextUrl.searchParams.get('token') : null;
  if (statsToken && tokenMatches(statsToken, process.env.STATS_TOKEN)) return exchanged(req, STATS_COOKIE, statsToken, '/stats');

  const expected = process.env.STUDIO_TOKEN;
  if (!expected) return NextResponse.next();

  // Health stays open so an uptime check does not need the secret. It reports
  // whether services are reachable and never touches project data.
  if (req.nextUrl.pathname === '/api/health') return NextResponse.next();

  // So do the front page, the privacy policy and the terms, and the front
  // page's demo media: they hold nothing of anyone's, and Google's OAuth
  // consent screen links to the policy and terms for anyone to read.
  if (publicPage(req.nextUrl.pathname)) return NextResponse.next();

  // `?token=...` is the way in: it is exchanged for a cookie and stripped from
  // the URL immediately, so the secret is not left in history, in a bookmark,
  // or in the referrer of every outbound link on the page.
  const fromQuery = req.nextUrl.searchParams.get('token');
  if (fromQuery && tokenMatches(fromQuery, expected)) return exchanged(req, COOKIE, expected, '/');

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const cookie = req.cookies.get(COOKIE)?.value;
  const supplied = bearer || cookie;
  if (supplied && tokenMatches(supplied, expected)) return NextResponse.next();

  return NextResponse.json(
    { error: 'This studio requires STUDIO_TOKEN. Open it once as ?token=<the token>.' },
    { status: 401 }
  );
}

export const config = {
  // Everything the app serves, minus Next's own static output -- those carry
  // no project data and blocking them would only break the 401 page itself.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
