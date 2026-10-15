import { stat } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { qfPassageFile, qfPassageOf } from '@/lib/qfRecitations';
import { findFfmpeg } from '@/lib/renderRunner';
import { servedFile } from '@/lib/servedFile';

/**
 * A built-in reciter's passage as one recording: its ayah files laid end to
 * end (`qfRecitations`). What the studio plays, the sidecar aligns and an
 * export carries.
 */
export async function GET(req: NextRequest) {
  const passage = qfPassageOf(req.nextUrl.pathname + req.nextUrl.search);
  if (!passage) return NextResponse.json({ error: 'Not a reciter passage.' }, { status: 400 });
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return NextResponse.json({ error: 'ffmpeg is not installed on this server.' }, { status: 500 });
  try {
    const file = await qfPassageFile(passage.reciterId, passage.surah, passage.start, passage.end, ffmpeg);
    if (!file) return NextResponse.json({ error: 'That passage is not in this recitation.' }, { status: 404 });
    const { size } = await stat(file);
    const { status, headers, body } = servedFile({ file, size }, req.headers.get('range'), 'audio/mpeg');
    return new NextResponse(body, { status, headers });
  } catch (err) {
    return NextResponse.json({ error: `Could not prepare the recitation: ${(err as Error).message}` }, { status: 502 });
  }
}
