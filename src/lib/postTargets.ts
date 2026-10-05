/**
 * Where a finished clip goes next, and how it gets there without an account.
 *
 * The studio has no accounts and should not need any to post: the person signs
 * in to the platform, not to us. Two ways do that with nothing to register or
 * review (FutureIdeas #59):
 *
 * - the system share sheet (`navigator.share` with the file). On a phone it
 *   lists the installed TikTok, Instagram and YouTube apps, which take the
 *   video and open their own posting screen, already signed in;
 * - the platform's upload page in a new tab, with the caption on the clipboard
 *   to paste beside the file that was just downloaded.
 *
 * Posting through the platforms' APIs is the later step, and each of them
 * holds an unreviewed app to private-only posts, so it is not this.
 */

import type { PublishMetadata } from './publishMetadata';

export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';

/** The platform each export preset is shaped for -- the ids are `exportPresets`'s. */
export const PLATFORM_FOR_PRESET: Record<string, Platform> = {
  shorts: 'youtube',
  youtube: 'youtube',
  tiktok: 'tiktok',
  reels: 'instagram',
  'ig-portrait': 'instagram',
  'ig-feed': 'instagram',
  facebook: 'facebook'
};

/**
 * Each platform's own page for posting a video from a browser.
 *
 * Instagram has no address for its create dialog: its web app opens it from
 * the "Create" button, so the home page is as close as a link gets.
 */
export const UPLOAD_PAGES: Record<Platform, string> = {
  youtube: 'https://www.youtube.com/upload',
  tiktok: 'https://www.tiktok.com/upload',
  instagram: 'https://www.instagram.com/',
  facebook: 'https://www.facebook.com/reels/create'
};

const ALL_PLATFORMS: Platform[] = ['youtube', 'tiktok', 'instagram', 'facebook'];

/** Every platform, the ones these presets were rendered for first. */
export function postTargets(presetIds: string[]): Platform[] {
  const rendered = presetIds.map(id => PLATFORM_FOR_PRESET[id]).filter((p): p is Platform => Boolean(p));
  return [...new Set([...rendered, ...ALL_PLATFORMS])];
}

/** Whether a platform is one the clip was rendered for, so it can be offered first. */
export function renderedFor(platform: Platform, presetIds: string[]): boolean {
  return presetIds.some(id => PLATFORM_FOR_PRESET[id] === platform);
}

/**
 * The caption as one block, for a share sheet or a single paste.
 *
 * Title, a blank line, then the description: the hashtags are already at the
 * end of the description, which is where every one of these platforms reads
 * them from.
 */
export function postText(meta: Pick<PublishMetadata, 'title' | 'description'>): string {
  return `${meta.title}\n\n${meta.description}`.trim();
}

/** What `navigator.canShare` is asked, so the check can be tested without a browser. */
export type CanShare = (data: { files: File[] }) => boolean;

/**
 * The file to hand the share sheet, or null where this browser cannot share
 * files -- desktop Firefox, and most desktop Linux browsers -- so the button is
 * simply not offered rather than failing when pressed.
 */
export function shareableFile(blob: Blob, name: string, canShare: CanShare | undefined): File | null {
  if (!canShare) return null;
  const file = new File([blob], name, { type: blob.type || (name.endsWith('.mp4') ? 'video/mp4' : 'video/webm') });
  try {
    return canShare({ files: [file] }) ? file : null;
  } catch {
    return null;
  }
}
