/**
 * Whether this installation serves one person or the public.
 *
 * `STUDIO_MODE=public` is written by `./install.sh --public` and read at run
 * time, on the server, so the routes that must refuse in public mode can: a
 * setting baked into the browser bundle would only hide a button, and the
 * route behind it would still answer anyone who called it. The browser learns
 * the mode from `/api/studio`.
 */
export type StudioMode = 'personal' | 'public';

export function studioMode(env: Record<string, string | undefined> = process.env): StudioMode {
  return env.STUDIO_MODE?.trim().toLowerCase() === 'public' ? 'public' : 'personal';
}

/**
 * Routes a public installation does not serve.
 *
 * Saved projects and export records have no owner -- there are no accounts --
 * so on a shared server every visitor would list and delete everyone else's.
 * Ground truth writes uploads to this server's disk, and background renders
 * spend its CPU on one visitor's video for minutes. Projects are kept in each
 * visitor's own browser instead.
 */
const CLOSED_IN_PUBLIC = ['/api/projects', '/api/exports', '/api/ground-truth', '/api/render'];

export function closedInPublicMode(pathname: string): boolean {
  return CLOSED_IN_PUBLIC.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
