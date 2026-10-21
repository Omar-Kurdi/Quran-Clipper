import { stat } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { qfPassageFile, qfPassageOf, QfSurahUnavailable } from '@/lib/qfRecitations';
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
    const { size, ino } = await stat(file);
    // The file is touched each time it is served, so its times change; a passage made again is a new file.
    const etag = `"${ino}-${size}"`;
    if (req.headers.get('if-none-match') === etag) return new NextResponse(null, { status: 304, headers: { etag, 'cache-control': 'no-cache' } });
    const { status, headers, body } = servedFile({ file, size, etag }, req.headers.get('range'), 'audio/mpeg');
    return new NextResponse(body, { status, headers });
  } catch (err) {
    if (err instanceof QfSurahUnavailable) return NextResponse.json({ error: err.message }, { status: 404 });
    return NextResponse.json({ error: `Could not prepare the recitation: ${(err as Error).message}` }, { status: 502 });
  }
}
