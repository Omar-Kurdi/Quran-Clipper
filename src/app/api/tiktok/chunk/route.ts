import { NextRequest, NextResponse } from 'next/server';
import { isTikTokUploadUrl } from '@/lib/tiktokUpload';
import { tiktokRequest } from '@/lib/tiktokRoute';

export const dynamic = 'force-dynamic';

/**
 * Passes one piece of the file on to TikTok's upload address. The address
 * comes in a header, not the URL, and must be TikTok's own; the piece is sent
 * as it came, with the byte range the page gives. TikTok answers 206 while
 * more pieces are due and 201 once the file is whole.
 */
export async function POST(req: NextRequest) {
  const asked = tiktokRequest(req);
  if ('refused' in asked) return asked.refused;
  if (!asked.client || !asked.held) return NextResponse.json({ error: 'signin' }, { status: 401 });
  const target = req.headers.get('x-upload-url') ?? '';
  const range = req.headers.get('x-content-range') ?? '';
  if (!isTikTokUploadUrl(target) || !/^bytes \d+-\d+\/\d+$/.test(range)) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const piece = await req.arrayBuffer();
  try {
    const res = await fetch(target, {
      method: 'PUT',
      headers: { 'Content-Type': req.headers.get('content-type') || 'video/mp4', 'Content-Range': range },
      body: piece
    });
    return NextResponse.json({ status: res.status }, { status: res.ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ error: 'network' }, { status: 502 });
  }
}
