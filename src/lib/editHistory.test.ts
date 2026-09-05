import { describe, it, expect } from 'vitest';
import {
  initHistory, record, replacePresent, undo, redo, canUndo, canRedo, HISTORY_LIMIT
} from './editHistory';

/** Snapshots are compared by identity, so a state is just a distinct object. */
const state = (name: string) => ({ name });

describe('editHistory', () => {
  it('starts with nothing to undo or redo', () => {
    const history = initHistory(state('a'));
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });

  it('ignores a record of the state it already holds', () => {
    const a = state('a');
    const history = initHistory(a);
    expect(record(history, a, { at: 1000 })).toBe(history);
  });

  it('walks back and forward through recorded steps', () => {
    const [a, b, c] = [state('a'), state('b'), state('c')];
    let history = initHistory(a);
    history = record(history, b, { at: 1000 });
    history = record(history, c, { at: 5000 });

    history = undo(history);
    expect(history.present).toBe(b);
    history = undo(history);
    expect(history.present).toBe(a);
    expect(canUndo(history)).toBe(false);

    history = redo(history);
    expect(history.present).toBe(b);
    history = redo(history);
    expect(history.present).toBe(c);
    expect(canRedo(history)).toBe(false);
  });

  it('refuses to walk past either end', () => {
    const history = initHistory(state('a'));
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });

  it('folds changes that arrive in quick succession into one step', () => {
    // A slider drag: one edit per pixel, one thing the user did.
    const [a, b, c, d] = [state('a'), state('b'), state('c'), state('d')];
    let history = initHistory(a);
    history = record(history, b, { at: 1000 });
    history = record(history, c, { at: 1100 });
    history = record(history, d, { at: 1250 });

    expect(history.present).toBe(d);
    expect(history.past).toEqual([a]);
    expect(undo(history).present).toBe(a);
  });

  it('starts a new step once the changes stop for a moment', () => {
    const [a, b, c] = [state('a'), state('b'), state('c')];
    let history = initHistory(a);
    history = record(history, b, { at: 1000 });
    history = record(history, c, { at: 3000 });
    expect(history.past).toEqual([a, b]);
  });

  it('keeps a forced step separate however fast it followed', () => {
    const [a, b, c] = [state('a'), state('b'), state('c')];
    let history = initHistory(a);
    history = record(history, b, { at: 1000 });
    history = record(history, c, { at: 1050, separate: true });
    expect(history.past).toEqual([a, b]);
  });

  it('never folds an edit into a state that was just undone to', () => {
    // Undo, then edit immediately: the restored state has to stay reachable.
    const [a, b, c] = [state('a'), state('b'), state('c')];
    let history = initHistory(a);
    history = record(history, b, { at: 1000 });
    history = undo(history);
    history = record(history, c, { at: 1050 });
    expect(history.present).toBe(c);
    expect(undo(history).present).toBe(a);
  });

  it('drops a redo trail as soon as something new is recorded', () => {
    const [a, b, c] = [state('a'), state('b'), state('c')];
    let history = initHistory(a);
    history = record(history, b, { at: 1000 });
    history = undo(history);
    expect(canRedo(history)).toBe(true);
    history = record(history, c, { at: 5000 });
    expect(canRedo(history)).toBe(false);
  });

  it('forgets the oldest steps rather than growing without bound', () => {
    let history = initHistory(state('first'));
    const last = HISTORY_LIMIT + 20;
    for (let i = 1; i <= last; i++) history = record(history, state(`s${i}`), { at: i * 10_000 });
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    // The oldest surviving step, not the very first state.
    expect(history.past[0]).toEqual({ name: `s${last - HISTORY_LIMIT}` });
  });

  it('carries a passenger change without making a step of it', () => {
    const [a, b] = [state('a'), state('b')];
    let history = initHistory(a);
    history = record(history, b, { at: 1000 });
    history = undo(history);
    const carried = state('a-with-a-different-selection');
    history = replacePresent(history, carried);

    expect(history.present).toBe(carried);
    expect(history.past).toEqual([]);
    // The redo it was in the middle of survives.
    expect(canRedo(history)).toBe(true);
    expect(redo(history).present).toBe(b);
  });
});
