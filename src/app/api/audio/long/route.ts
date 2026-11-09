import { readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { keptSource } from '@/lib/editSources';
import { longCutWindow } from '@/lib/longAudio';
import { LISTEN_ID, cutLongAudio, forgetOldListens, listenFile, readEnvelope } from '@/lib/longAudioServer';
import { findFfmpeg } from '@/lib/renderRunner';
import { servedFile } from '@/lib/servedFile';
import { studioMode } from '@/lib/studioMode';

/**
 * A recording too long for the browser to trim (`longAudio.ts`).
 *
 * `op=read`: the recording once (`source`), kept here by its hash as an edit's
 * is (`editSources`), and its peak envelope and length back with the id.
 * `op=cut`: the id, and the stretch to keep; that stretch back as an MP3.
 * GET `?id=`: the copy to listen to while trimming (`readEnvelope`).
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || '';
  if (studioMode() === 'public' || !LISTEN_ID.test(id)) return NextResponse.json({ error: 'No such recording.' }, { status: 404 });
  const file = listenFile(id);
  const size = await stat(file).then(info => info.size, () => 0);
  if (!size) return NextResponse.json({ error: 'No such recording.' }, { status: 404 });
  const { status, headers, body } = servedFile({ file, size }, req.headers.get('range'), 'audio/ogg');
  return new NextResponse(body, { status, headers });
}

export async function POST(req: NextRequest) {
  // A public studio's disk is not a store for visitors' recordings, as for editing.
  if (studioMode() === 'public') {
    return NextResponse.json({ error: 'Trimming a recording this long is not offered on this public studio.' }, { status: 403 });
  }
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return NextResponse.json({ error: 'ffmpeg is not installed on this server.' }, { status: 500 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'The recording did not arrive whole.' }, { status: 413 });
  }
  const source = await keptSource(form);
  if ('error' in source) return NextResponse.json({ error: source.error }, { status: source.status });
  try {
    return form.get('op') === 'cut' ? await cut(ffmpeg, source.file, form) : await read(ffmpeg, source);
  } catch (err) {
    return NextResponse.json({ error: `Could not read the recording: ${(err as Error).message.split('\n').slice(-2).join(' ')}` }, { status: 502 });
  }
}

async function read(ffmpeg: string, source: { id: string; file: string }) {
  await forgetOldListens();
  const { envelope, duration } = await readEnvelope(ffmpeg, source.file, listenFile(source.id));
  return NextResponse.json(
    { id: source.id, duration, envelope: Buffer.from(envelope).toString('base64') },
    { headers: { 'cache-control': 'no-store' } }
  );
}

async function cut(ffmpeg: string, file: string, form: FormData) {
  const window = longCutWindow(Number(form.get('start')), Number(form.get('end')), Number(form.get('duration')));
  if (!window) return NextResponse.json({ error: 'That is no stretch to keep, or longer than one trim keeps.' }, { status: 400 });
  const output = path.join(os.tmpdir(), `qc-long-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.mp3`);
  try {
    await cutLongAudio(ffmpeg, file, window.start, window.end, output);
    const bytes = await readFile(output);
    return new NextResponse(new Uint8Array(bytes), { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
  } finally {
    await rm(output, { force: true });
  }
}

