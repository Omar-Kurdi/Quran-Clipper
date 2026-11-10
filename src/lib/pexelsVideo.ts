/** What Pexels' API says about one rendition of a video. */
export type PexelsVideoFile = { link?: string; width?: number; height?: number; file_type?: string };

/**
 * The rendition to hand back: the largest whose long edge still fits 1080p
 * output, falling back to the smallest on offer when everything is bigger. A 4K
 * clip decoding behind a 1080x1920 canvas costs frame rate during export and
 * buys nothing.
 */
const MAX_LONG_EDGE = 1920;

export function pickVideoFile(files: PexelsVideoFile[]): string | null {
  const usable = files
    .filter(file => typeof file.link === 'string' && file.file_type !== 'video/quicktime')
    .map(file => ({ link: file.link!, longEdge: Math.max(file.width || 0, file.height || 0) }))
    .sort((a, b) => a.longEdge - b.longEdge);
  if (usable.length === 0) return null;
  const withinBudget = usable.filter(file => file.longEdge > 0 && file.longEdge <= MAX_LONG_EDGE);
  return (withinBudget.length > 0 ? withinBudget[withinBudget.length - 1] : usable[0]).link;
}
