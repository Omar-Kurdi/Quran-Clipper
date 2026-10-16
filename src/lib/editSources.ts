/**
 * Recordings of one's own, kept on the server while they are being edited.
 *
 * Every edit is rendered from the recording as uploaded, never from an earlier
 * edit, and sending a long recording again for each change of speed would be
 * most of the wait. So the upload is kept here by its hash, and the next edit
 * names it instead (`sourceId`). Outside the checkout like every recording
 * here, and the least recently edited go first once they pass a limit.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const sourcesDir = () => path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'quran-clipper', 'edit-sources');
/** Bigger than any clip worth editing, and small enough to not be a way in. */
const MAX_SOURCE_BYTES = 200 * 1024 * 1024;
const MAX_SOURCES_BYTES = 2 * 1024 * 1024 * 1024;
const SOURCE_ID = /^[0-9a-f]{64}$/;

/**
 * The upload an edit is of: sent now, or kept from an earlier edit and named
 * by `sourceId`. `source gone` (404) asks the studio to send the file again.
 */
export async function keptSource(form: FormData): Promise<{ id: string; file: string } | { error: string; status: number }> {
  const sent = form.get('source');
  if (!(sent instanceof File && sent.size > 0)) {
    const id = String(form.get('sourceId') || '');
    const file = path.join(sourcesDir(), id);
    if (!SOURCE_ID.test(id) || !existsSync(file)) return { error: 'source gone', status: 404 };
    void utimes(file, new Date(), new Date()).catch(() => undefined);
    return { id, file };
  }
  if (sent.size > MAX_SOURCE_BYTES) return { error: 'That recording is too large to edit here.', status: 413 };
  const bytes = Buffer.from(await sent.arrayBuffer());
  const id = createHash('sha256').update(bytes).digest('hex');
  const file = path.join(sourcesDir(), id);
  if (existsSync(file)) return { id, file };
  await mkdir(sourcesDir(), { recursive: true });
  await writeFile(file, bytes);
  // Over the limit, the least recently edited go, never the one just kept.
  const names = (await readdir(sourcesDir())).filter(name => SOURCE_ID.test(name) && name !== id);
  const kept = await Promise.all(names.map(async name => ({ file: path.join(sourcesDir(), name), ...(await stat(path.join(sourcesDir(), name))) })));
  let total = bytes.length + kept.reduce((sum, entry) => sum + entry.size, 0);
  const evicted = kept.sort((a, b) => a.mtimeMs - b.mtimeMs).filter(entry => {
    if (total <= MAX_SOURCES_BYTES) return false;
    total -= entry.size;
    return true;
  });
  await Promise.all(evicted.map(entry => rm(entry.file, { force: true })));
  return { id, file };
}
