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
 * What `next.config.ts` bakes into the browser on top of the `NEXT_PUBLIC_`
 * values from the environment and .env files.
 *
 * A public studio's server serves Saheeh International (20) whatever
 * .env.local names (`defaultTranslationId`), but the browser's copy of that id
 * is fixed at build time from NEXT_PUBLIC_QURAN_TRANSLATION_ID. Built with the
 * owner's 131 there, captions holding 20's text were labelled 131 and the
 * Translations chip showed a bare "131". Next.js loads .env files before it
 * reads its config, so STUDIO_MODE from .env.local is seen here too.
 */
export function browserEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  return studioMode(env) === 'public' ? { NEXT_PUBLIC_QURAN_TRANSLATION_ID: '20' } : {};
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

/**
 * Pages anyone may read whatever `STUDIO_TOKEN` says: the front page, the
 * privacy policy and the terms, and the front page's demo media. They hold
 * nothing of anyone's, and Google's OAuth consent screen links to the policy
 * and terms for anyone to open.
 */
export function publicPage(pathname: string): boolean {
  return ['/', '/privacy', '/terms'].includes(pathname) || pathname.startsWith('/landing/');
}
