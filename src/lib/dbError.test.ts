import { describe, it, expect } from 'vitest';
import { describeDbError } from './dbError';

describe('describeDbError', () => {
  it('reports the cause, not the SQL the wrapper carries as its message', () => {
    // Drizzle's message is the statement it tried to run; the reason is the
    // cause. Reporting the message sent a wall of SELECT and no reason at all.
    const wrapped = new Error('select "id" from "projects"');
    wrapped.cause = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    expect(describeDbError(wrapped)).toContain('ECONNREFUSED');
    expect(describeDbError(wrapped)).not.toContain('select "id"');
  });

  it('tells you how to start the database when it is unreachable', () => {
    const wrapped = new Error('sql');
    wrapped.cause = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    expect(describeDbError(wrapped)).toContain('npm run db:start');
  });

  it('tells you to push the schema when a column is missing', () => {
    const wrapped = new Error('sql');
    wrapped.cause = new Error('column "surah_badge_text" does not exist');
    expect(describeDbError(wrapped)).toContain('npm run db:push');
  });

  it('follows a nested chain to the deepest cause', () => {
    const inner = new Error('Connection terminated unexpectedly');
    const middle = new Error('pool error'); middle.cause = inner;
    const outer = new Error('sql'); outer.cause = middle;
    expect(describeDbError(outer)).toContain('Connection terminated');
  });

  it('survives a cyclic cause chain rather than spinning', () => {
    const a = new Error('a'); const b = new Error('b');
    a.cause = b; b.cause = a;
    expect(typeof describeDbError(a)).toBe('string');
  });

  it('handles something thrown that was never an Error', () => {
    expect(describeDbError('plain string')).toContain('plain string');
  });
});
