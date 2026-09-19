import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createJob, inputsFromForm, listJobs, outputPath, publicJob, readJob, removeJob } from '@/lib/renderJobs';
import { cancelRender, kickRenders, renderAvailability } from '@/lib/renderRunner';
import { isActive, isRenderId, parseRenderSpec } from '@/lib/serverRender';

/**
 * Server renders, as the studio sees them: list, submit, cancel, download.
 *
 * The render page's own traffic -- reading its job, reporting progress,
 * handing back the picture -- is `./worker`, behind the job's key.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Per file. Larger than any recitation or background clip worth rendering. */
const MAX_INPUT_BYTES = 1024 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (id) return download(id);

  const availability = renderAvailability();
  const jobs = await listJobs();
  // After a restart nothing else would pick the waiting jobs up again.
  if (availability.available && jobs.some(isActive)) kickRenders(req.nextUrl.origin);
  return NextResponse.json({ success: true, ...availability, jobs: jobs.map(publicJob) });
}

/** The finished file, as an attachment under the name the studio gave it. */
async function download(id: string) {
  if (!isRenderId(id)) return NextResponse.json({ success: false, error: 'No such render.' }, { status: 404 });
  const job = await readJob(id);
  if (!job || job.status !== 'done') {
    return NextResponse.json({ success: false, error: 'That render is not finished.' }, { status: 404 });
  }
  const file = outputPath(job);
  const { size } = await stat(file);
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(job.fileName)}`,
    },
  });
}

export async function POST(req: NextRequest) {
  const availability = renderAvailability();
  if (!availability.available) {
    return NextResponse.json({ success: false, error: availability.reason }, { status: 503 });
  }
  try {
    const form = await req.formData();
    const specField = form.get('spec');
    const spec = parseRenderSpec(specField instanceof Blob ? await specField.text() : String(specField || ''));
    if (!spec) {
      return NextResponse.json({ success: false, error: 'The render is missing its description.' }, { status: 400 });
    }
    const { inputs, missing } = await inputsFromForm(form, spec);
    if (!inputs) {
      return NextResponse.json({ success: false, error: `${missing} did not arrive.` }, { status: 400 });
    }
    if (inputs.some(input => input.data.length > MAX_INPUT_BYTES)) {
      return NextResponse.json({ success: false, error: 'A file is too large to render.' }, { status: 413 });
    }

    const job = await createJob(spec, inputs);
    kickRenders(req.nextUrl.origin);
    return NextResponse.json({ success: true, job: publicJob(job) });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'The render could not be queued.' },
      { status: 500 }
    );
  }
}

/** Cancels a waiting or running render; removes one that has ended, file and all. */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || '';
  if (!isRenderId(id)) return NextResponse.json({ success: false, error: 'No such render.' }, { status: 404 });
  const job = await readJob(id);
  if (!job) return NextResponse.json({ success: false, error: 'That render is no longer listed.' }, { status: 404 });
  if (isActive(job)) {
    const cancelled = await cancelRender(id);
    return NextResponse.json({ success: true, job: cancelled && publicJob(cancelled) });
  }
  await removeJob(id);
  return NextResponse.json({ success: true, id });
}
