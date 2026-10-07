/**
 * The order the background gallery is listed in.
 *
 * By length first, longest first: a background is chosen to cover a
 * recitation, and how long it runs before it loops is what decides whether it
 * does. A still, or footage not measured yet, has no length to sort by and
 * follows the clips that do; a background whose file is gone is always last.
 */

export const GALLERY_SORTS = ['longest', 'shortest', 'name', 'yours'] as const;
export type GallerySort = typeof GALLERY_SORTS[number];
export const DEFAULT_GALLERY_SORT: GallerySort = 'longest';

export interface Sortable {
  title: string;
  url: string | null;
  missing: boolean;
  /** One the user added, rather than a preset. */
  removable: boolean;
}

export function sortGallery<T extends Sortable>(items: readonly T[], by: GallerySort, lengths: Record<string, number>): T[] {
  const lengthOf = (item: T) => (item.url && Number.isFinite(lengths[item.url]) ? lengths[item.url] : null);
  const compare = (a: T, b: T): number => {
    if (a.missing !== b.missing) return a.missing ? 1 : -1;
    if (by === 'name') return a.title.localeCompare(b.title);
    if (by === 'yours') return Number(b.removable) - Number(a.removable);
    const la = lengthOf(a);
    const lb = lengthOf(b);
    if (la === null || lb === null) return la === lb ? 0 : la === null ? 1 : -1;
    return by === 'longest' ? lb - la : la - lb;
  };
  // Stable, so items the order cannot tell apart keep the gallery's own order.
  return items.map((item, index) => ({ item, index }))
    .sort((a, b) => compare(a.item, b.item) || a.index - b.index)
    .map(entry => entry.item);
}
