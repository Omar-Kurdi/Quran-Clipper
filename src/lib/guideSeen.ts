/**
 * Whether the welcome guide has been seen in this browser, per interface
 * language.
 *
 * Per language because switching to Arabic is a second first visit: someone
 * who reads the studio in Arabic may never have read the English guide, and
 * every name it uses has changed.
 *
 * A per-browser convenience, so storage that is blocked or full is not an
 * error: unreadable counts as seen -- better never offered unprompted than
 * offered on every visit -- and a write that fails simply means it is offered
 * again next time.
 *
 * A new key, not the first-visit tour's (`quranclipper.tour.v1`, removed in
 * the redesign): whoever saw that tour has not seen this guide.
 */

export const GUIDE_SEEN_KEY = 'quranclipper.guide.v1';

const keyFor = (locale: string) => `${GUIDE_SEEN_KEY}.${locale}`;

export function guideSeen(locale: string): boolean {
  try {
    return Boolean(localStorage.getItem(keyFor(locale)));
  } catch {
    return true;
  }
}

/** Remembers that it was, in this language. False when storage refused. */
export function rememberGuideSeen(locale: string): boolean {
  try {
    localStorage.setItem(keyFor(locale), '1');
    return true;
  } catch {
    return false;
  }
}
