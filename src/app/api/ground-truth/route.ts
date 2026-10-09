import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { groundTruthAudioName, groundTruthFileName, unsavedClipName, withClipName } from '@/lib/groundTruth';
import { studioMode } from '@/lib/studioMode';
import { writeGroundTruthAudio } from '@/lib/groundTruthCut';

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
 * A personal studio's tool, in development or a production build alike: it
 * writes to this checkout's `scripts/`, which is where the owner's
 * `./gauge.sh` reads. Never on a public studio, which takes nobody's files onto
 * its disk -- the middleware closes the route there too. The studio falls back
 * to downloading the text file when this answers 404.
 */
export const runtime = 'nodejs';


export async function POST(req: NextRequest) {
  if (studioMode() === 'public') {
    return NextResponse.json({ success: false, error: 'not available' }, { status: 404 });
  }

  try {
    const form = await req.formData();
    // A Blob, so the multipart encoder cannot turn its newlines into CRLF.
    const field = form.get('contents');
    const sent = field instanceof Blob ? await field.text() : String(field || '');
    const dir = path.join(process.cwd(), 'scripts');
    // Beside an earlier save of the same name, never over it.
    const clipName = unsavedClipName(String(form.get('clipName') || ''), relative => existsSync(path.join(dir, relative)));
    const contents = withClipName(sent, groundTruthAudioName(clipName));

    if (!sent.trim()) {
      return NextResponse.json({ success: false, error: 'nothing to write' }, { status: 400 });
    }

    // Both names come from `groundTruthBaseName`, which keeps `[A-Za-z0-9_-]`
    // and nothing else -- so neither can climb out of `scripts/`, and the two
    // agree on their stem, which is what lets `# clip:` find the audio.
    const textName = groundTruthFileName(clipName);
    const written: string[] = [textName];

    await writeFile(path.join(dir, textName), contents, 'utf8');

    const audioWritten = await writeGroundTruthAudio(form, dir, clipName);
    if (audioWritten && 'error' in audioWritten) {
      return NextResponse.json({ success: false, error: audioWritten.error, written }, { status: audioWritten.status });
    }
    if (audioWritten) written.push(audioWritten.written);

    return NextResponse.json({ success: true, written });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'write failed' },
      { status: 500 }
    );
  }
}

