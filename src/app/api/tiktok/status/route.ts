import { NextRequest, NextResponse } from 'next/server';
import { tiktokApi } from '@/lib/tiktokVault';
import { keepTikTok, liveAccess } from '@/lib/tiktokRoute';

export const dynamic = 'force-dynamic';

/** Where a sent draft stands at TikTok: still being taken in, in the person's inbox, posted, or failed and why. */
export async function POST(req: NextRequest) {
  const live = await liveAccess(req);
  if ('refused' in live) return live.refused;
  const { publishId } = (await req.json().catch(() => ({}))) as { publishId?: unknown };
  if (typeof publishId !== 'string' || !publishId) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const answer = await tiktokApi('/v2/post/publish/status/fetch/', live.held.access, { publish_id: publishId });
  const res = answer.code === 'ok'
    ? NextResponse.json({ status: answer.data.status, failReason: answer.data.fail_reason })
    : NextResponse.json({ error: answer.code }, { status: answer.status >= 400 ? answer.status : 502 });
  return live.renewed ? keepTikTok(res, req, live.held, live.client, live.renewed) : res;
}
