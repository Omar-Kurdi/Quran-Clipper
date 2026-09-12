import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { groundTruthAudioName, groundTruthFileName } from '@/lib/groundTruth';

/**
 * Writes a ground-truth file and its audio straight into `scripts/`.
 *
 * The button used to download a text file and stop there, which left the loop
 * two manual steps short and quietly broken. The text names the recording it
 * describes, but the recording only ever existed in the browser: trimming in
 * the studio is destructive and produces `x-trimmed.wav` in memory and nowhere
 * else. So `./gauge.sh` skipped those files -- it was asked to score a timeline
 * against audio that was never on disk, and the only way to get it there was to
 * reproduce the same cut by hand with ffmpeg.
 *
 * Saving the audio the captions were actually corrected against removes the
 * reproduction step entirely. The copy written here is already trimmed, so the
 * file it accompanies carries `# trim: none` and the evaluator simply decodes
 * it.
 *
 * Development only. This writes to the repository checkout, which a deployed
 * instance has no business doing and generally cannot; the studio falls back to
 * downloading the text file when this is not here.
 */
export const runtime = 'nodejs';

/** Bigger than any clip worth aligning, and small enough to not be a way in. */
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ success: false, error: 'not available' }, { status: 404 });
  }

  try {
    const form = await req.formData();
    // Sent as a Blob so the multipart encoder cannot rewrite its newlines --
    // a text field would arrive with CRLF on every line.
    const field = form.get('contents');
    const contents = field instanceof Blob ? await field.text() : String(field || '');
    const clipName = String(form.get('clipName') || '');
    const audio = form.get('audio');

    if (!contents.trim()) {
      return NextResponse.json({ success: false, error: 'nothing to write' }, { status: 400 });
    }

    // Both names come from `groundTruthBaseName`, which keeps `[A-Za-z0-9_-]`
    // and nothing else -- so neither can climb out of `scripts/`, and the two
    // agree on their stem, which is what lets `# clip:` find the audio.
    const dir = path.join(process.cwd(), 'scripts');
    const textName = groundTruthFileName(clipName);
    const written: string[] = [textName];

    await writeFile(path.join(dir, textName), contents, 'utf8');

    if (audio instanceof File && audio.size > 0) {
      if (audio.size > MAX_AUDIO_BYTES) {
        return NextResponse.json(
          { success: false, error: 'audio too large' },
          { status: 413 }
        );
      }
      const audioDir = path.join(dir, 'audio');
      await mkdir(audioDir, { recursive: true });
      const audioName = groundTruthAudioName(clipName);
      await writeFile(path.join(audioDir, audioName), Buffer.from(await audio.arrayBuffer()));
      written.push(path.join('audio', audioName));
    }

    return NextResponse.json({ success: true, written });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'write failed' },
      { status: 500 }
    );
  }
}
