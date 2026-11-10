import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { TIKTOK_CHANNEL } from '@/lib/tiktokUpload';
import { TIKTOK_PATH, TIKTOK_STATE_COOKIE, exchangeCode, tiktokClient } from '@/lib/tiktokVault';
import { keepTikTok, redirectUri } from '@/lib/tiktokRoute';

export const dynamic = 'force-dynamic';

type Outcome = 'ok' | 'denied' | 'scope' | 'failed';

/**
 * The pop-up's last page: tells the studio's tab how the sign-in went, over a
 * same-origin BroadcastChannel (TikTok's pages cut the pop-up off from its
 * opener), and closes itself.
 */
function page(outcome: Outcome): NextResponse {
  const message = JSON.stringify({ outcome });
  const html = `<!doctype html><meta charset="utf-8"><title>TikTok</title>
<body style="font:14px system-ui;background:#0f172a;color:#e2e8f0;padding:24px">
<p>${outcome === 'ok' ? 'Signed in to TikTok. You can close this window.' : 'TikTok sign-in did not finish. You can close this window.'}</p>
<script>try{new BroadcastChannel(${JSON.stringify(TIKTOK_CHANNEL)}).postMessage(${message})}catch(e){}setTimeout(function(){window.close()},300)</script>`;
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Trades TikTok's code for tokens kept on this browser, once the `state` proves this browser asked. */
export async function GET(req: NextRequest) {
  const client = tiktokClient();
  if (!client) return page('failed');
  const params = req.nextUrl.searchParams;
  const state = params.get('state') ?? '';
  const expected = req.cookies.get(TIKTOK_STATE_COOKIE)?.value ?? '';
  const code = params.get('code');
  let outcome: Outcome = 'failed';
  let res: NextResponse;
  if (!expected || !same(state, expected)) {
    res = page('failed');
  } else if (params.get('error') || !code) {
    res = page('denied');
  } else {
    const grant = await exchangeCode(code, client, redirectUri(req));
    outcome = grant.ok ? 'ok' : grant.reason === 'scope' ? 'scope' : 'failed';
    res = page(outcome);
    if (grant.ok) keepTikTok(res, req, grant.held, client, grant.keepFor);
  }
  res.cookies.set(TIKTOK_STATE_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: TIKTOK_PATH, maxAge: 0 });
  return res;
}
