import { NextRequest, NextResponse } from 'next/server';
import { TIKTOK_MAX_BYTES, chunkPlan } from '@/lib/tiktokUpload';
import { tiktokApi } from '@/lib/tiktokVault';
import { keepTikTok, liveAccess } from '@/lib/tiktokRoute';

export const dynamic = 'force-dynamic';

/** Asks TikTok for an upload address for a draft of `size` bytes, and says how to cut the file for it. */
export async function POST(req: NextRequest) {
  const live = await liveAccess(req);
  if ('refused' in live) return live.refused;
  const { size } = (await req.json().catch(() => ({}))) as { size?: unknown };
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > TIKTOK_MAX_BYTES) {
    return NextResponse.json({ error: 'size' }, { status: 400 });
  }
  const plan = chunkPlan(size);
  const answer = await tiktokApi('/v2/post/publish/inbox/video/init/', live.held.access, {
    source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: plan.chunkSize, total_chunk_count: plan.count }
  });
  const uploadUrl = answer.data.upload_url;
  const publishId = answer.data.publish_id;
  const res = answer.code === 'ok' && typeof uploadUrl === 'string' && typeof publishId === 'string'
    ? NextResponse.json({ publishId, uploadUrl, ...plan })
    : NextResponse.json({ error: answer.code }, { status: answer.status >= 400 ? answer.status : 502 });
  return live.renewed ? keepTikTok(res, req, live.held, live.client, live.renewed) : res;
}
