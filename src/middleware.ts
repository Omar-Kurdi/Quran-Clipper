import { NextRequest, NextResponse } from 'next/server';

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

/** Comparison that does not leak how much of the token was right. */
function tokenMatches(supplied: string, expected: string): boolean {
  if (supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < supplied.length; i++) {
    diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export function middleware(req: NextRequest) {
  const expected = process.env.STUDIO_TOKEN;
  if (!expected) return NextResponse.next();

  // Health stays open so an uptime check does not need the secret. It reports
  // whether services are reachable and never touches project data.
  if (req.nextUrl.pathname === '/api/health') return NextResponse.next();

  // `?token=...` is the way in: it is exchanged for a cookie and stripped from
  // the URL immediately, so the secret is not left in history, in a bookmark,
  // or in the referrer of every outbound link on the page.
  const fromQuery = req.nextUrl.searchParams.get('token');
  if (fromQuery && tokenMatches(fromQuery, expected)) {
    const clean = req.nextUrl.clone();
    clean.searchParams.delete('token');
    const res = NextResponse.redirect(clean);
    res.cookies.set(COOKIE, expected, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.nextUrl.protocol === 'https:',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  }

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
