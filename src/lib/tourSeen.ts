/**
 * Whether the first-visit walkthrough has been seen in this browser, per
 * interface language.
 *
 * Per language because switching to Arabic is a second first visit: every
 * label the tour pointed at has a new name, and someone who reads the studio
 * in Arabic may never have read the English tour at all.
 *
 * A per-browser convenience, so storage that is blocked or full is not an
 * error: unreadable counts as seen -- better never offered unprompted than
 * offered on every visit -- and a write that fails simply means it is offered
 * again next time.
 */

/** Set once the walkthrough has been finished or skipped here. English keeps the key it always had. */
export const TOUR_SEEN_KEY = 'quranclipper.tour.v1';

const keyFor = (locale: string) => (locale === 'en' ? TOUR_SEEN_KEY : `${TOUR_SEEN_KEY}.${locale}`);

export function tourSeen(locale: string): boolean {
  try {
    return Boolean(localStorage.getItem(keyFor(locale)));
  } catch {
    return true;
  }
}

/** Remembers that it was, in this language. False when storage refused. */
export function rememberTourSeen(locale: string): boolean {
  try {
    localStorage.setItem(keyFor(locale), '1');
    return true;
  } catch {
    return false;
  }
}
