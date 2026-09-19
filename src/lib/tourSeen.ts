/**
 * Whether the first-visit walkthrough has been seen in this browser.
 *
 * A per-browser convenience, so storage that is blocked or full is not an
 * error: unreadable counts as seen -- better never offered unprompted than
 * offered on every visit -- and a write that fails simply means it is offered
 * again next time.
 */

/** Set once the walkthrough has been finished or skipped here. */
export const TOUR_SEEN_KEY = 'quranclipper.tour.v1';

export function tourSeen(): boolean {
  try {
    return Boolean(localStorage.getItem(TOUR_SEEN_KEY));
  } catch {
    return true;
  }
}

/** Remembers that it was. False when storage refused. */
export function rememberTourSeen(): boolean {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    return true;
  } catch {
    return false;
  }
}
