/**
 * The built-in reciters' recordings kept in step with the Quran Foundation
 * while the studio runs.
 *
 * Their Developer Terms let stored content -- audio included -- be kept past a
 * week only when it is maintained through the Content Sync APIs, synced at
 * least every seven days. `scripts/qf-reciters.mjs sync` does that; start.sh
 * runs it when due, and a server left running for weeks runs it from here,
 * checking every six hours. The script decides whether anything is due and
 * holds a lock, so a check here costs nothing when it is not.
 *
 * The Quran text saved projects are checked against is kept the same way
 * (`scripts/qf-text.mjs sync`, `qfTextStore`), on the same checks.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';

/** How often the running server asks whether a sync is due. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** The first check, once the server has settled. */
const FIRST_CHECK_AFTER_MS = 60 * 1000;
/** Long enough for a sync that has to fetch changed surahs again. */
const SYNC_TIMEOUT_MS = 60 * 60 * 1000;

let scheduled = false;

function runSync(script: string, label: string): void {
  execFile(process.execPath, [path.join(process.cwd(), 'scripts', script), 'sync', '--if-due', '--quiet'],
    { timeout: SYNC_TIMEOUT_MS }, (error, _stdout, stderr) => {
      // Reported, never thrown: what is kept stays as it is and the next check tries again.
      if (error) console.warn(`[${label}] ${stderr.trim() || error.message}`);
    });
}

function syncIfDue(): void {
  runSync('qf-reciters.mjs', 'recitation sync');
  runSync('qf-text.mjs', 'text sync');
}

/** Starts the checks, once per server. */
export function scheduleRecitationSync(): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(syncIfDue, FIRST_CHECK_AFTER_MS).unref();
  setInterval(syncIfDue, CHECK_EVERY_MS).unref();
}
