/**
 * Undo and redo, as a value.
 *
 * Every timeline edit in the studio is already a pure function returning a new
 * array (`verseEdits`), and the styling config is replaced wholesale on each
 * change -- so a history here is a list of the states those functions produced,
 * not a log of commands to invert. Nothing has to know how to undo itself.
 *
 * Two things this deliberately does *not* do. It does not diff: identity is the
 * comparison, because both tracked values are React state that only changes
 * identity when something actually edited them. And it does not decide what a
 * step is on its own -- a drag fires an edit per pixel, so changes arriving
 * within `coalesceMs` of the last one fold into the top entry rather than
 * making fifty of them.
 */

export interface History<T> {
  /** Oldest first. The most recent entry is what an undo returns to. */
  past: T[];
  present: T;
  /** Undone states, most recently undone first. */
  future: T[];
  /**
   * When the present was recorded, in epoch milliseconds. `0` means "not part
   * of any run", which is what a restored state is: the next edit after an undo
   * always starts a new step.
   */
  at: number;
}

/** Long enough to swallow a drag or a run of keystrokes, short enough that a pause ends the step. */
export const COALESCE_MS = 600;

/**
 * How far back undo reaches. A snapshot is two object references, so the cost
 * is the states themselves -- which are shared with the live ones until they
 * are edited -- rather than fifty copies of the timeline.
 */
export const HISTORY_LIMIT = 50;

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], at: 0 };
}

export const canUndo = <T>(history: History<T>): boolean => history.past.length > 0;
export const canRedo = <T>(history: History<T>): boolean => history.future.length > 0;

export interface RecordOptions {
  /** Now, in epoch milliseconds. Passed in so the folding rule is testable. */
  at: number;
  coalesceMs?: number;
  limit?: number;
  /** Forces a step of its own, however quickly it followed the last one. */
  separate?: boolean;
}

/** Records `next` as the present, either as a new step or folded into the current one. */
export function record<T>(history: History<T>, next: T, options: RecordOptions): History<T> {
  if (next === history.present) return history;

  const coalesceMs = options.coalesceMs ?? COALESCE_MS;
  const limit = options.limit ?? HISTORY_LIMIT;
  // A run only continues from a state that was itself recorded as an edit;
  // `at: 0` -- the initial state, and anything just undone to -- never merges.
  const continues = !options.separate && history.at > 0 && options.at - history.at < coalesceMs;

  if (continues) return { ...history, present: next, future: [], at: options.at };

  const past = [...history.past, history.present];
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    present: next,
    future: [],
    at: options.at
  };
}

/**
 * Swaps the present for an equivalent one without touching the history.
 *
 * For state that rides along in a snapshot without being an edit of its own --
 * which segment is selected, here. Clicking around the timeline must not fill
 * the undo stack, and must not throw away a redo either.
 */
export function replacePresent<T>(history: History<T>, next: T): History<T> {
  if (next === history.present) return history;
  return { ...history, present: next };
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    at: 0
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
    at: 0
  };
}
