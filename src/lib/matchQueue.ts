/**
 * One alignment at a time, in the order asked, with each waiter able to see
 * where it stands.
 *
 * Exports are not queued here: they run in each visitor's own browser and
 * never touch this server. Alignment does -- the sidecar reads the audio on
 * this machine's CPU, and two at once only make both slower -- so on a shared
 * server it is the one thing visitors actually wait on each other for.
 *
 * The match request itself waits its turn and still returns the result, so
 * nothing about the studio's match flow changes. What the queue adds is a
 * ticket: the browser mints one, sends it with the request, and asks
 * `/api/audio/queue?ticket=` for its position and an estimate while it waits.
 *
 * In memory, in this process: `next start` is one process, and a queue that
 * outlived a restart would be holding requests whose connections are gone.
 */

export interface QueueStatus {
  /** 0 while running; 1 is next; null when the ticket is not in the queue. */
  position: number | null;
  /** Seconds until this ticket should be done, from recent match times. */
  etaSeconds: number | null;
}

/** What a match is assumed to take before any has been measured. */
const FIRST_GUESS_MS = 30_000;
/** How many recent matches the estimate averages. */
const RECENT = 10;

export class QueueFullError extends Error {
  constructor(readonly limit: number) {
    super(`The studio is busy: ${limit} matches are already waiting. Try again in a few minutes.`);
    this.name = 'QueueFullError';
  }
}

/**
 * Where one ticket stands, from what is running, what is waiting, and how long
 * a match has been taking.
 */
function standing(
  ticket: string,
  running: { ticket: string; startedAt: number } | null,
  waiting: string[],
  each: number,
  now: number
): QueueStatus {
  const left = running ? Math.max(0, each - (now - running.startedAt)) : 0;
  if (running?.ticket === ticket) return { position: 0, etaSeconds: Math.max(1, Math.round(left / 1000)) };
  const index = waiting.indexOf(ticket);
  if (index < 0) return { position: null, etaSeconds: null };
  return { position: index + 1, etaSeconds: Math.round((left + each * (index + 1)) / 1000) };
}

export function createMatchQueue(limit: number, now: () => number = Date.now) {
  const waiting: string[] = [];
  let running: { ticket: string; startedAt: number } | null = null;
  const durations: number[] = [];
  let wake: (() => void)[] = [];

  const average = () =>
    durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : FIRST_GUESS_MS;

  const advance = () => {
    const next = wake;
    wake = [];
    next.forEach(resolve => resolve());
  };

  const turnOf = (ticket: string) =>
    new Promise<void>(resolve => {
      const check = () => {
        if (!running && waiting[0] === ticket) resolve();
        else wake.push(check);
      };
      check();
    });

  return {
    async run<T>(ticket: string, work: () => Promise<T>): Promise<T> {
      if (waiting.length >= limit) throw new QueueFullError(limit);
      waiting.push(ticket);
      await turnOf(ticket);
      waiting.shift();
      running = { ticket, startedAt: now() };
      try {
        return await work();
      } finally {
        durations.push(now() - running.startedAt);
        if (durations.length > RECENT) durations.shift();
        running = null;
        advance();
      }
    },

    status(ticket: string): QueueStatus {
      return standing(ticket, running, waiting, average(), now());
    },

    get length() {
      return waiting.length + (running ? 1 : 0);
    },
  };
}

/** How many may wait at once before a new request is turned away. */
export const MATCH_QUEUE_LIMIT = Number(process.env.MATCH_QUEUE_LIMIT) || 20;

// One queue per server process, shared by the match route and the status route.
const globalKey = Symbol.for('quranclipper.matchQueue');
type Queue = ReturnType<typeof createMatchQueue>;
export const matchQueue: Queue =
  ((globalThis as Record<symbol, unknown>)[globalKey] as Queue | undefined) ??
  ((globalThis as Record<symbol, unknown>)[globalKey] = createMatchQueue(MATCH_QUEUE_LIMIT)) as Queue;

/** A ticket as the browser sends it, or a fresh one when it sent none. */
export function ticketFrom(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  return /^[A-Za-z0-9_-]{8,64}$/.test(text) ? text : `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
