import { NextRequest, NextResponse } from 'next/server';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { inputPath, picturePath, readJob, readSpec, updateJob } from '@/lib/renderJobs';
import { isInputName, isRenderId, withInputUrls } from '@/lib/serverRender';

/**
 * The render page's side of a server render.
 *
 * Every request carries the job's id and its key, which only the url the
 * runner opened contains, and is refused unless that job is the one rendering
 * now. So nothing but the browser the runner started can read a job's files or
 * move it along.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function rendering(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || '';
  const key = req.nextUrl.searchParams.get('key') || '';
  if (!isRenderId(id)) return null;
  const job = await readJob(id);
  return job && job.key === key && job.status === 'rendering' ? job : null;
}

const refused = () => NextResponse.json({ success: false, error: 'Not a render in progress.' }, { status: 403 });

/** The job's description with its inputs pointed here, or one of its input files. */
export async function GET(req: NextRequest) {
  const job = await rendering(req);
  if (!job) return refused();
  const name = req.nextUrl.searchParams.get('file');
  if (name) {
    if (!isInputName(name)) return refused();
    const file = inputPath(job.id, name);
    const { size } = await stat(file);
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: { 'Content-Type': job.inputTypes[name] || 'application/octet-stream', 'Content-Length': String(size) },
    });
  }
  const spec = await readSpec(job.id);
  if (!spec) return refused();
  return NextResponse.json({
    success: true,
    spec: { ...spec, config: withInputUrls(spec.config, job.id, job.key) },
  });
}

/** Progress, or the reason the render could not go on. Either also says the page is alive. */
export async function PATCH(req: NextRequest) {
  const job = await rendering(req);
  if (!job) return refused();
  const body = await req.json().catch(() => ({})) as { progress?: number; error?: string };
  await updateJob(job.id, current => {
    if (current.status !== 'rendering') return null;
    if (body.error) return { status: 'failed', error: String(body.error).slice(0, 500) };
    return { progress: Math.max(0, Math.min(99, Math.round(Number(body.progress) || 0))) };
  });
  return NextResponse.json({ success: true });
}

/** The encoded picture. Streamed to disk: a long render is hundreds of megabytes. */
export async function PUT(req: NextRequest) {
  const job = await rendering(req);
  if (!job || !req.body) return refused();
  await pipeline(Readable.fromWeb(req.body as import('node:stream/web').ReadableStream), createWriteStream(picturePath(job.id)));
  await updateJob(job.id, current => (current.status === 'rendering' ? { status: 'finishing', progress: 99 } : null));
  return NextResponse.json({ success: true });
}
