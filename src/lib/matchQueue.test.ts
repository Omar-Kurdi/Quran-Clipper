import { describe, it, expect } from 'vitest';
import { createMatchQueue, QueueFullError, ticketFrom } from './matchQueue';

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

describe('ticketFrom', () => {
  it('keeps a well-formed ticket and replaces anything else', () => {
    expect(ticketFrom('abc12345_XY')).toBe('abc12345_XY');
    expect(ticketFrom('short')).toMatch(/^t_/);
    expect(ticketFrom('../../etc/passwd')).toMatch(/^t_/);
    expect(ticketFrom(null)).toMatch(/^t_/);
  });
});
