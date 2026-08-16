import { NextRequest, NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';

const memoryExports: any[] = [];

async function getDbBindings() {
  if (!process.env.DATABASE_URL) return null;
  const [{ db }, schema] = await Promise.all([
    import('@/db'),
    import('@/db/schema')
  ]);
  return { db, exportsTable: schema.exports };
}

export async function GET() {
  try {
    const bindings = await getDbBindings();
    if (!bindings) {
      return NextResponse.json({ success: true, source: 'memory', exports: memoryExports.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 20) });
    }
    const list = await bindings.db.select().from(bindings.exportsTable).orderBy(desc(bindings.exportsTable.createdAt)).limit(20);
    return NextResponse.json({ success: true, source: 'database', exports: list });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const id = `exp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const exportRecord = {
      id,
      projectId: body.projectId || null,
      title: body.title || 'Quran Video Export',
      fileUrl: body.fileUrl || '',
      aspectRatio: body.aspectRatio || '9:16',
      duration: body.duration || 0,
      resolution: body.resolution || '1080x1920',
      fileSizeBytes: body.fileSizeBytes || 0,
      fps: body.fps || 60,
      renderTimeMs: body.renderTimeMs || 0,
      gpuDevice: body.gpuDevice || 'NVIDIA GeForce RTX 5080 (WebGPU Acceleration)',
      createdAt: new Date()
    };

    const bindings = await getDbBindings();
    if (!bindings) {
      memoryExports.unshift(exportRecord);
      return NextResponse.json({ success: true, source: 'memory', exportRecord });
    }

    await bindings.db.insert(bindings.exportsTable).values(exportRecord);
    return NextResponse.json({ success: true, source: 'database', exportRecord });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
