import { describe, it, expect } from 'vitest';
import { createMatchQueue, QueueFullError, VisitorBusyError, AbandonedError, ticketFrom, visitorFrom } from './matchQueue';

/** A match that finishes when told to, so the test decides the order. */
const deferred = () => {
  let finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  return { done, finish };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createMatchQueue', () => {
  it('runs one match at a time, in the order asked, and says where each stands', async () => {
    let clock = 0;
    const queue = createMatchQueue(5, () => clock);
    const first = deferred();
    const second = deferred();
    const order: string[] = [];

    const a = queue.run('ticket-a', async () => { order.push('a'); await first.done; });
    const b = queue.run('ticket-b', async () => { order.push('b'); await second.done; });
    await tick();

    expect(order).toEqual(['a']);
    expect(queue.status('ticket-a').position).toBe(0);
    expect(queue.status('ticket-b').position).toBe(1);

    clock = 12_000;
    first.finish();
    await a;
    await tick();
    expect(order).toEqual(['a', 'b']);
    expect(queue.status('ticket-a').position).toBeNull();
    // One match measured at 12s: the one now running is estimated from it.
    expect(queue.status('ticket-b')).toEqual({ position: 0, etaSeconds: 12 });

    second.finish();
    await b;
    expect(queue.length).toBe(0);
  });
});

describe('createMatchQueue estimates', () => {
  it('estimates a wait from the matches ahead of it', async () => {
    let clock = 0;
    const queue = createMatchQueue(5, () => clock);
    const running = deferred();
    void queue.run('ticket-a', () => running.done);
    void queue.run('ticket-b', async () => {});
    void queue.run('ticket-c', async () => {});
    await tick();
    clock = 10_000;
    // First guess 30s a match: 20s left of the running one, then b, then c.
    expect(queue.status('ticket-c')).toEqual({ position: 2, etaSeconds: 80 });
    running.finish();
  });
});

describe('createMatchQueue limits', () => {
  it('turns a request away once the queue is full, and keeps going after a failure', async () => {
    const queue = createMatchQueue(1);
    const running = deferred();
    const a = queue.run('ticket-a', () => running.done);
    await tick();
    const b = queue.run('ticket-b', async () => 'b');
    await expect(queue.run('ticket-c', async () => 'c')).rejects.toBeInstanceOf(QueueFullError);
    running.finish();
    await a;
    await expect(b).resolves.toBe('b');

    await expect(queue.run('ticket-d', async () => { throw new Error('sidecar down'); })).rejects.toThrow('sidecar down');
    await expect(queue.run('ticket-e', async () => 'e')).resolves.toBe('e');
  });
});

describe('createMatchQueue on a public studio', () => {
  it('lets one visitor hold only their share of the queue', async () => {
    const queue = createMatchQueue(20, Date.now, 2);
    const running = deferred();
    const a = queue.run('ticket-a', () => running.done, { visitor: '203.0.113.5' });
    const b = queue.run('ticket-b', async () => 'b', { visitor: '203.0.113.5' });
    await tick();
    await expect(queue.run('ticket-c', async () => 'c', { visitor: '203.0.113.5' })).rejects.toBeInstanceOf(VisitorBusyError);
    // Someone else is not held up by it.
    const d = queue.run('ticket-d', async () => 'd', { visitor: '198.51.100.7' });
    running.finish();
    await a;
    await expect(b).resolves.toBe('b');
    await expect(d).resolves.toBe('d');
    // Their share frees up as their matches finish.
    await expect(queue.run('ticket-e', async () => 'e', { visitor: '203.0.113.5' })).resolves.toBe('e');
    expect(queue.counts()).toMatchObject({ completed: 4, turnedAway: 1, running: 0, waiting: 0 });
  });

});

describe('createMatchQueue when a visitor leaves', () => {
  it('drops a waiting match whose visitor left, and moves everyone behind it up', async () => {
    const queue = createMatchQueue(20);
    const running = deferred();
    const left = new AbortController();
    const order: string[] = [];
    const a = queue.run('ticket-a', async () => { order.push('a'); await running.done; });
    const b = queue.run('ticket-b', async () => { order.push('b'); }, { signal: left.signal });
    const c = queue.run('ticket-c', async () => { order.push('c'); });
    await tick();
    expect(queue.status('ticket-c').position).toBe(2);

    left.abort();
    await expect(b).rejects.toBeInstanceOf(AbandonedError);
    expect(queue.status('ticket-b').position).toBeNull();
    expect(queue.status('ticket-c').position).toBe(1);

    running.finish();
    await a;
    await c;
    expect(order).toEqual(['a', 'c']);
    expect(queue.counts()).toMatchObject({ completed: 2, abandoned: 1 });
  });

  it('drops the next in line when it leaves, and runs the one after', async () => {
    const queue = createMatchQueue(20);
    const running = deferred();
    const left = new AbortController();
    const a = queue.run('ticket-a', () => running.done);
    const b = queue.run('ticket-b', async () => 'b', { signal: left.signal });
    const c = queue.run('ticket-c', async () => 'c');
    await tick();
    left.abort();
    await expect(b).rejects.toBeInstanceOf(AbandonedError);
    running.finish();
    await a;
    await expect(c).resolves.toBe('c');
  });

});

describe('createMatchQueue when a visitor has gone', () => {
  it('never starts a match whose visitor had already gone', async () => {
    const queue = createMatchQueue(20);
    const gone = new AbortController();
    gone.abort();
    let ran = false;
    await expect(queue.run('ticket-a', async () => { ran = true; }, { signal: gone.signal })).rejects.toBeInstanceOf(AbandonedError);
    expect(ran).toBe(false);
    expect(queue.length).toBe(0);
  });

  it('lets a running match finish when its visitor leaves', async () => {
    const queue = createMatchQueue(20);
    const running = deferred();
    const left = new AbortController();
    const a = queue.run('ticket-a', async () => { await running.done; return 'a'; }, { signal: left.signal });
    await tick();
    left.abort();
    running.finish();
    await expect(a).resolves.toBe('a');
  });

});

describe('createMatchQueue monitoring', () => {
  it('counts failures', async () => {
    const queue = createMatchQueue(20, () => Date.UTC(2026, 8, 27, 12));
    await expect(queue.run('ticket-a', async () => { throw new Error('sidecar down'); })).rejects.toThrow();
    expect(queue.counts()).toMatchObject({ failed: 1, lastFailureAt: '2026-09-27T12:00:00.000Z' });
  });
});

describe('visitorFrom', () => {
  it("takes the address Caddy added, not one the client sent", () => {
    expect(visitorFrom(new Headers({ 'x-forwarded-for': '10.0.0.1, 203.0.113.5' }))).toBe('203.0.113.5');
    expect(visitorFrom(new Headers({ 'x-forwarded-for': '203.0.113.5' }))).toBe('203.0.113.5');
    expect(visitorFrom(new Headers())).toBeNull();
  });
});

describe('ticketFrom', () => {
  it('keeps a well-formed ticket and replaces anything else', () => {
    expect(ticketFrom('abc12345_XY')).toBe('abc12345_XY');
    expect(ticketFrom('short')).toMatch(/^t_/);
    expect(ticketFrom('../../etc/passwd')).toMatch(/^t_/);
    expect(ticketFrom(null)).toMatch(/^t_/);
  });
});
