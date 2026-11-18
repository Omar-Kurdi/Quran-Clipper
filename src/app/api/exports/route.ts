import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, isNotNull, max } from 'drizzle-orm';
import { describeDbError } from '@/lib/dbError';

const memoryExports: any[] = [];

async function getDbBindings() {
  if (!process.env.DATABASE_URL) return null;
  const [{ db }, schema] = await Promise.all([
    import('@/db'),
    import('@/db/schema')
  ]);
  return { db, exportsTable: schema.exports };
}

/**
 * Which clips have been exported: `?done=1` answers with every project and
 * clip that has a render on record -- a clip id of '' for the project as a
 * whole -- and when it was last rendered, for the tabs' and the library's
 * ticks, rather than the last twenty records the drawer lists.
 */
async function exportedClips(projectId: string | null) {
  const bindings = await getDbBindings();
  if (!bindings) {
    const latest = new Map<string, { projectId: string; clipId: string; exportedAt: string }>();
    for (const row of memoryExports.filter(each => each.projectId && (!projectId || each.projectId === projectId))) {
      const entry = { projectId: row.projectId as string, clipId: (row.clipId as string) || '', exportedAt: new Date(row.createdAt).toISOString() };
      const key = `${entry.projectId}\u0000${entry.clipId}`;
      if ((latest.get(key)?.exportedAt ?? '') < entry.exportedAt) latest.set(key, entry);
    }
    return NextResponse.json({ success: true, source: 'memory', done: [...latest.values()] });
  }
  const table = bindings.exportsTable;
  const done = await bindings.db
    .select({ projectId: table.projectId, clipId: table.clipId, exportedAt: max(table.createdAt) })
    .from(table)
    .where(and(isNotNull(table.projectId), projectId ? eq(table.projectId, projectId) : undefined))
    .groupBy(table.projectId, table.clipId);
  return NextResponse.json({ success: true, source: 'database', done });
}

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams;
    if (query.get('done') === '1') return await exportedClips(query.get('projectId'));
    const bindings = await getDbBindings();
    if (!bindings) {
      return NextResponse.json({ success: true, source: 'memory', exports: memoryExports.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 20) });
    }
    const list = await bindings.db.select().from(bindings.exportsTable).orderBy(desc(bindings.exportsTable.createdAt)).limit(20);
    return NextResponse.json({ success: true, source: 'database', exports: list });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: describeDbError(err) }, { status: 500 });
  }
}

/**
 * Deletes one export record.
 *
 * The same shape as the projects delete -- id on the query string, 404 rather
 * than a silent 200 when the row has already gone -- because the drawer treats
 * the two lists the same way. Nothing but the record is removed: the video was
 * never held here, only the note of having made it.
 */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'No export id given.' }, { status: 400 });
    }

    const bindings = await getDbBindings();
    if (!bindings) {
      const idx = memoryExports.findIndex(e => e.id === id);
      if (idx < 0) {
        return NextResponse.json({ success: false, error: 'That render is no longer listed.' }, { status: 404 });
      }
      memoryExports.splice(idx, 1);
      return NextResponse.json({ success: true, source: 'memory', id });
    }

    const removed = await bindings.db
      .delete(bindings.exportsTable)
      .where(eq(bindings.exportsTable.id, id))
      .returning({ id: bindings.exportsTable.id });
    if (removed.length === 0) {
      return NextResponse.json({ success: false, error: 'That render is no longer listed.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, source: 'database', id });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: describeDbError(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const id = `exp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const exportRecord = {
      id,
      projectId: body.projectId || null,
      clipId: typeof body.clipId === 'string' ? body.clipId.slice(0, 64) : '',
      title: body.title || 'Quran Video Export',
      fileName: typeof body.fileName === 'string' ? body.fileName : '',
      aspectRatio: body.aspectRatio || '9:16',
      duration: body.duration || 0,
      resolution: body.resolution || '1080x1920',
      fileSizeBytes: Number.isFinite(body.fileSizeBytes) ? Math.round(body.fileSizeBytes) : 0,
      fps: body.fps || 60,
      renderTimeMs: body.renderTimeMs || 0,
      gpuDevice: body.gpuDevice || 'Unknown GPU',
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
    return NextResponse.json({ success: false, error: describeDbError(err) }, { status: 500 });
  }
}
