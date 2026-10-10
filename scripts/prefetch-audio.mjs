#!/usr/bin/env node
/**
 * Fills the audio proxy's cache with every built-in reciter's recordings, so
 * the studio never waits on -- or fails on -- a CDN.
 *
 * Which file a surah plays is decided by the studio, not here: its Load route
 * names the recording the timings belong to (the audited pairing, a measured
 * recording, QUL's file for a QUL reciter). So this asks that route, for ayah 1
 * of each surah, and has the studio's own proxy fetch what it names -- the
 * proxy checks the host, follows redirects only to allowed hosts, and keeps
 * the whole file in data/audio-cache/ (`src/lib/audioCache.ts`). Nothing is
 * downloaded here directly. About 14 GB for all ten reciters.
 *
 * Resumable: a recording already kept answers from the cache at once, so run
 * it again after an interruption or a CDN refusal. It needs the studio running
 * on this machine (./install.sh starts one for it if none is), and
 * STUDIO_TOKEN in the environment if the studio is set to require one:
 *
 *   node scripts/prefetch-audio.mjs                    # all ten, studio on :3000
 *   node scripts/prefetch-audio.mjs --port 45707 sudais yasser
 */

const RECITERS = ['sudais', 'yasser', 'shuraim', 'muaiqly', 'ghamdi', 'basit', 'shatri', 'rifai', 'tunaiji', 'jalil'];
const PARALLEL = 8;
const ATTEMPTS = 5;
/** How long one recording may take to arrive in the cache before it is asked for again. */
const WAIT_MS = 12 * 60_000;
const POLL_MS = 3000;

const args = process.argv.slice(2);
const portAt = args.indexOf('--port');
const port = portAt >= 0 ? Number(args.splice(portAt, 2)[1]) : 3000;
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port takes a port number');
// The studio on this machine only: it is what decides the recordings.
const studio = new URL(`http://localhost:${port}`);
const reciters = args.length ? args : RECITERS;
for (const name of reciters) if (!RECITERS.includes(name)) throw new Error(`${name} is not one of ${RECITERS.join(', ')}`);

// A studio with STUDIO_TOKEN set answers nothing without it (`src/middleware.ts`).
const auth = process.env.STUDIO_TOKEN ? { Authorization: `Bearer ${process.env.STUDIO_TOKEN}` } : {};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** `step`, tried again after a growing pause until it succeeds or `ATTEMPTS` run out. */
async function retried(step, attempt = 1) {
  try {
    return await step();
  } catch (err) {
    if (attempt >= ATTEMPTS) throw err;
    await sleep(attempt * 10_000);
    return retried(step, attempt + 1);
  }
}

/** A path on the studio, never another host. */
function onStudio(pathAndQuery) {
  const url = new URL(pathAndQuery, studio);
  if (url.origin !== studio.origin) throw new Error(`not a studio address: ${pathAndQuery}`);
  return url;
}

/** The proxy address the studio plays for this reciter's surah. */
async function recordingFor(reciter, surah) {
  const res = await fetch(onStudio(`/api/quran/verses?surah=${surah}&start=1&end=1&reciter=${reciter}`), { headers: auth });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.audioUrl) throw new Error(body.error || `studio answered ${res.status}`);
  return onStudio(body.audioUrl);
}

/** Whether the proxy answers this recording from its cache -- and, if not, has it start keeping it. */
async function kept(proxied) {
  const res = await fetch(proxied, { headers: { ...auth, Range: 'bytes=0-0' } });
  await res.arrayBuffer();
  if (res.status !== 200 && res.status !== 206) throw new Error(`proxy answered ${res.status}`);
  return res.headers.get('x-audio-cache') === 'hit';
}

/** Until the recording is in the cache, or `WAIT_MS` has passed. */
async function arrived(proxied, since = Date.now()) {
  if (await kept(proxied)) return;
  if (Date.now() - since > WAIT_MS) throw new Error('not kept in time');
  await sleep(POLL_MS);
  return arrived(proxied, since);
}

const jobs = reciters.flatMap(reciter => Array.from({ length: 114 }, (_, i) => ({ reciter, surah: i + 1 })));
const failed = [];

async function work() {
  const job = jobs.shift();
  if (!job) return;
  const name = `${job.reciter}:${job.surah}`;
  try {
    const proxied = await retried(() => recordingFor(job.reciter, job.surah));
    const was = await retried(() => kept(proxied));
    if (!was) await retried(() => arrived(proxied));
    console.log(`${name}  ${was ? 'kept already' : 'kept'}  ${proxied.searchParams.get('url')}`);
  } catch (err) {
    failed.push(name);
    console.log(`${name}  FAILED  ${err.message}`);
  }
  return work();
}

await Promise.all(Array.from({ length: PARALLEL }, work));
console.log(failed.length ? `\n${failed.length} failed -- run again to retry: ${failed.join(' ')}` : '\nall kept');
process.exitCode = failed.length ? 1 : 0;
