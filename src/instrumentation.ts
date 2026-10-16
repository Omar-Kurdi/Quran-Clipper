/**
 * Runs once when a studio server starts. Only the Node.js server does
 * anything: it keeps the built-in reciters' recordings synced with the Quran
 * Foundation while it runs (see `recitationSync`).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { scheduleRecitationSync } = await import('./lib/recitationSync');
  scheduleRecitationSync();
}
