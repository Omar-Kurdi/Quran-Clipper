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
 * One visitor already has as many matches in the queue as one visitor may.
 * The queue is fair, but without this one visitor could fill all of it.
 */
export class VisitorBusyError extends Error {
  constructor(readonly limit: number) {
    super(`You already have ${limit} ${limit === 1 ? 'match' : 'matches'} waiting. Let ${limit === 1 ? 'it' : 'them'} finish before starting another.`);
    this.name = 'VisitorBusyError';
  }
}

/** The request gave up -- its visitor closed the tab -- before its turn came. */
export class AbandonedError extends Error {
  constructor() {
    super('The match was abandoned before its turn.');
    this.name = 'AbandonedError';
  }
}

/** What the queue has done since the server started, for `/api/health`. */
export interface QueueCounts {
  running: number;
  waiting: number;
  limit: number;
  perVisitor: number;
  completed: number;
  failed: number;
  /** Dropped from the queue because their visitor left before their turn. */
  abandoned: number;
  /** Refused because the queue, or that visitor's share of it, was full. */
  turnedAway: number;
  /** When the last match failed, as an ISO time; null if none has. */
  lastFailureAt: string | null;
}

interface Entry {
  ticket: string;
  visitor?: string;
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

/** What happened to the matches this queue has seen. */
interface Tally {
  completed: number;
  failed: number;
  abandoned: number;
  turnedAway: number;
  lastFailureAt: number | null;
}

class MatchQueue {
  private readonly waiting: Entry[] = [];
  private running: (Entry & { startedAt: number }) | null = null;
  private readonly durations: number[] = [];
  private wake: (() => void)[] = [];
  private readonly tally: Tally = { completed: 0, failed: 0, abandoned: 0, turnedAway: 0, lastFailureAt: null };

  constructor(
    private readonly limit: number,
    private readonly now: () => number,
    private readonly perVisitor: number
  ) {}

  /**
   * Runs `work` on this ticket's turn. `visitor` (the caller's address, on a
   * public studio) caps how many one visitor may hold at once; `signal` drops
   * the request from the queue if it is aborted before its turn. A match
   * already running is left to finish: the sidecar would go on reading the
   * audio anyway, so starting the next one early would only run two at once.
   */
  async run<T>(ticket: string, work: () => Promise<T>, opts: { visitor?: string; signal?: AbortSignal } = {}): Promise<T> {
    this.admit(opts.visitor);
    const entry: Entry = { ticket, visitor: opts.visitor };
    this.waiting.push(entry);
    await this.turnOf(entry, opts.signal);
    this.waiting.shift();
    const running = { ...entry, startedAt: this.now() };
    this.running = running;
    try {
      const result = await work();
      this.tally.completed++;
      return result;
    } catch (err) {
      this.tally.failed++;
      this.tally.lastFailureAt = this.now();
      throw err;
    } finally {
      this.durations.push(this.now() - running.startedAt);
      if (this.durations.length > RECENT) this.durations.shift();
      this.running = null;
      this.advance();
    }
  }

  status(ticket: string): QueueStatus {
    return standing(ticket, this.running, this.waiting.map(e => e.ticket), this.average(), this.now());
  }

  get length() {
    return this.waiting.length + (this.running ? 1 : 0);
  }

  counts(): QueueCounts {
    const { lastFailureAt, ...tally } = this.tally;
    return {
      running: this.running ? 1 : 0,
      waiting: this.waiting.length,
      limit: this.limit,
      perVisitor: this.perVisitor,
      ...tally,
      lastFailureAt: lastFailureAt === null ? null : new Date(lastFailureAt).toISOString(),
    };
  }

  /** Turns the request away when the queue, or this visitor's share of it, is full. */
  private admit(visitor?: string) {
    if (this.waiting.length >= this.limit) {
      this.tally.turnedAway++;
      throw new QueueFullError(this.limit);
    }
    if (visitor && this.held(visitor) >= this.perVisitor) {
      this.tally.turnedAway++;
      throw new VisitorBusyError(this.perVisitor);
    }
  }

  private held(visitor: string) {
    return this.waiting.filter(e => e.visitor === visitor).length + (this.running?.visitor === visitor ? 1 : 0);
  }

  private average() {
    const { durations } = this;
    return durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : FIRST_GUESS_MS;
  }

  private advance() {
    const next = this.wake;
    this.wake = [];
    next.forEach(resolve => resolve());
  }

  /** Resolves on this entry's turn; rejects if `signal` aborts while it waits. */
  private turnOf(entry: Entry, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const leave = () => {
        const index = this.waiting.indexOf(entry);
        if (index < 0) return;
        this.waiting.splice(index, 1);
        this.tally.abandoned++;
        reject(new AbandonedError());
        // Everyone behind it moves up a place.
        this.advance();
      };
      const check = () => {
        if (!this.waiting.includes(entry)) return;
        if (!this.running && this.waiting[0] === entry) {
          signal?.removeEventListener('abort', leave);
          resolve();
        } else this.wake.push(check);
      };
      if (signal?.aborted) return leave();
      signal?.addEventListener('abort', leave, { once: true });
      check();
    });
  }
}

export function createMatchQueue(limit: number, now: () => number = Date.now, perVisitor = Infinity) {
  return new MatchQueue(limit, now, perVisitor);
}

/** How many may wait at once before a new request is turned away. */
export const MATCH_QUEUE_LIMIT = Number(process.env.MATCH_QUEUE_LIMIT) || 20;

/**
 * How many one visitor may have waiting or running at once. Two lets a batch
 * keep its next file queued behind the one running; the studio sends one at a
 * time anyway. Only applied where the route names a visitor (a public studio).
 */
export const MATCH_QUEUE_PER_VISITOR = Number(process.env.MATCH_QUEUE_PER_VISITOR) || 2;

// One queue per server process, shared by the match route and the status route.
const globalKey = Symbol.for('quranclipper.matchQueue');
type Queue = MatchQueue;
export const matchQueue: Queue =
  ((globalThis as Record<symbol, unknown>)[globalKey] as Queue | undefined) ??
  ((globalThis as Record<symbol, unknown>)[globalKey] = createMatchQueue(MATCH_QUEUE_LIMIT, Date.now, MATCH_QUEUE_PER_VISITOR)) as Queue;

/** A ticket as the browser sends it, or a fresh one when it sent none. */
export function ticketFrom(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  return /^[A-Za-z0-9_-]{8,64}$/.test(text) ? text : `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Who is asking, for the per-visitor cap: the address Caddy saw. The studio
 * listens on localhost behind Caddy, which replaces whatever
 * `X-Forwarded-For` a client sent with the address it connected from, so the
 * last entry is the one that cannot be forged. Null when there is none.
 */
export function visitorFrom(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  const last = forwarded?.split(',').map(part => part.trim()).filter(Boolean).pop();
  return last || headers.get('x-real-ip')?.trim() || null;
}
