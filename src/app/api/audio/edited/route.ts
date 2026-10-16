import { readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { decodeEdit, isEdited, keptSpans } from '@/lib/audioEdit';
import { renderEdit } from '@/lib/audioRender';
import { keptSource } from '@/lib/editSources';
import { qfEditedFile, qfPassage, qfPassageOf } from '@/lib/qfRecitations';
import { findFfmpeg } from '@/lib/renderRunner';
import { servedFile } from '@/lib/servedFile';
import { studioMode } from '@/lib/studioMode';

/** The most of a recitation a public studio edits at once: what it matches at once (`/api/audio/match`). */
const PUBLIC_MAX_EDIT_SEC = 600;

/**
 * A recording with an `AudioEdit` applied (`audioRender`).
 *
 * GET, for a built-in reciter's passage: the address carries the passage and
 * the edit, so a saved project plays it again from the synced ayah files and
 * keeps no copy of its own (`qfEditedFile`).
 *
 * POST, for a recording of one's own: the file once, kept here by its hash so
 * the next edit of it sends only that (`sourceId`), and the edited audio back.
 */
export async function GET(req: NextRequest) {
  const passage = qfPassageOf(`/api/audio/ayahs${req.nextUrl.search}`);
  const editText = req.nextUrl.searchParams.get('edit') || '';
  if (!passage || !editText) return NextResponse.json({ error: 'Not an edited reciter passage.' }, { status: 400 });
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return NextResponse.json({ error: 'ffmpeg is not installed on this server.' }, { status: 500 });
  try {
    // A public studio renders a visitor's edit only of as much as it would match for them.
    if (studioMode() === 'public' && ((await qfPassage(passage.reciterId, passage.surah, passage.start, passage.end))?.totalSeconds ?? Infinity) > PUBLIC_MAX_EDIT_SEC) {
      return NextResponse.json({ error: `Edit at most ${PUBLIC_MAX_EDIT_SEC / 60} minutes of a recitation at a time on this public studio.` }, { status: 400 });
    }
    const file = await qfEditedFile(passage, editText, ffmpeg);
    if (!file) return NextResponse.json({ error: 'That edit leaves nothing of this passage, or is not one.' }, { status: 400 });
    const { size } = await stat(file);
    const { status, headers, body } = servedFile({ file, size }, req.headers.get('range'), 'audio/flac');
    return new NextResponse(body, { status, headers });
  } catch (err) {
    return NextResponse.json({ error: `Could not edit the recitation: ${(err as Error).message}` }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  // A public studio's disk is not a store for visitors' recordings.
  if (studioMode() === 'public') {
    return NextResponse.json({ error: 'Editing your own recording is not offered on this public studio.' }, { status: 403 });
  }
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return NextResponse.json({ error: 'ffmpeg is not installed on this server.' }, { status: 500 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'The recording did not arrive whole.' }, { status: 413 });
  }
  const edit = decodeEdit(String(form.get('edit') || ''));
  const duration = Number(form.get('duration'));
  if (!edit || !isEdited(edit) || !(duration > 0) || !keptSpans(edit.cuts, duration).length) {
    return NextResponse.json({ error: 'That edit leaves nothing of the recording, or is not one.' }, { status: 400 });
  }

  const source = await keptSource(form);
  if ('error' in source) return NextResponse.json({ error: source.error }, { status: source.status });

  const output = path.join(os.tmpdir(), `qc-edit-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.flac`);
  try {
    await renderEdit(ffmpeg, source.file, edit, duration, output);
    const bytes = await readFile(output);
    return new NextResponse(new Uint8Array(bytes), {
      headers: { 'content-type': 'audio/flac', 'x-source-id': source.id, 'cache-control': 'no-store' },
    });
  } catch (err) {
    return NextResponse.json({ error: `Could not edit the recording: ${(err as Error).message.split('\n').slice(-3).join(' ')}` }, { status: 502 });
  } finally {
    await rm(output, { force: true });
  }
}
