export type Rect = { top: number; left: number; width: number; height: number };

/** Room around the highlighted element, so its border is not flush with the cut-out. */
export const HALO = 6;

/**
 * Where the guided tour's card goes on a phone, for a step about one of the
 * bottom tabs: across the screen, above what the step describes if the card
 * fits there, else below it, else just above the tab bar.
 *
 * It used to sit above the tab bar on every such step, so pressing Next left
 * it in place over the very list or controls each step was naming.
 */
export function phoneCardPosition(
  focus: Rect | null,
  tab: Rect,
  cardHeight: number,
  viewport: { width: number; height: number }
): { top?: number; bottom?: number; left: number; width: number } {
  const gap = HALO + 8;
  const across = { left: 12, width: viewport.width - 24 };
  const tabBarTop = tab.top - HALO - 10;
  if (focus) {
    const above = focus.top - gap - cardHeight;
    if (above >= 12) return { ...across, top: above };
    const below = focus.top + focus.height + gap;
    if (below + cardHeight <= tabBarTop) return { ...across, top: below };
  }
  return { ...across, bottom: viewport.height - tabBarTop };
}
