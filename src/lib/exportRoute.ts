/**
 * How an export with these destinations is carried out.
 *
 * The frame-by-frame encoder draws from the canvas as it is now, so only a
 * render in the studio's own shape can run straight away -- and only that one
 * keeps the result screen with its download, caption and render check. Several
 * destinations, or one in another shape, go through the queue, which switches
 * the studio to each job's shape and back afterwards. The server builds each
 * render's config from its plan, so it takes any shape.
 */
export type ExportRoute = 'single' | 'queue' | 'server';

export function exportRoute(aspectRatios: string[], studioAspect: string, onServer: boolean): ExportRoute {
  if (onServer) return 'server';
  return aspectRatios.length === 1 && aspectRatios[0] === studioAspect ? 'single' : 'queue';
}
