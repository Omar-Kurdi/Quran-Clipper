/**
 * Sending a finished clip to the person's TikTok drafts, from the studio.
 *
 * TikTok's Content Posting API has two ways in: Direct Post, which posts at
 * once and is held to private-only until TikTok audits the app, and upload,
 * which lands the video in the person's TikTok inbox as a draft for them to
 * finish -- caption, sound, cover -- and post from the app. This is the second:
 * nothing goes public without the person pressing Post in TikTok.
 *
 * Unlike Google, TikTok signs in only by redirect, and only to an https
 * address registered with the app, and its token endpoints need the client
 * secret. So the sign-in and every API call happen on the studio's server
 * (`tiktokVault`), the tokens never reach the page, and the file goes through
 * the server in chunks on its way (`/api/tiktok/chunk`). Offered only where
 * the server has `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`.
 */

/** Read the person's basic profile (TikTok requires it with Login Kit), and upload drafts. */
export const TIKTOK_SCOPES = 'user.info.basic,video.upload';

/** The route the sign-in pop-up opens, and the channel its last page reports on. */
export const TIKTOK_CONNECT_PATH = '/api/tiktok/connect';
export const TIKTOK_CHANNEL = 'qc-tiktok';

const MB = 1024 * 1024;
/**
 * The size each piece is sent in. TikTok takes chunks of 5 to 64 MB, the last
 * up to 128 MB, and a file under 5 MB whole; each piece passes through the
 * studio's server, so they are kept small enough to hold.
 */
export const TIKTOK_CHUNK = 16 * MB;
/** TikTok's own limit on a video's size. */
export const TIKTOK_MAX_BYTES = 4 * 1024 * MB;

export type ChunkPlan = { chunkSize: number; count: number };

/**
 * How a file of `size` bytes is cut for TikTok: whole up to one chunk's size,
 * else equal chunks with the remainder added to the last -- TikTok counts
 * `size / chunk_size` rounded down, so the last is between one and two chunks.
 */
export function chunkPlan(size: number, chunk = TIKTOK_CHUNK): ChunkPlan {
  if (size <= chunk) return { chunkSize: size, count: 1 };
  return { chunkSize: chunk, count: Math.floor(size / chunk) };
}

/** The bytes the `index`th piece covers, end exclusive. */
export function chunkRange(index: number, plan: ChunkPlan, size: number): { start: number; end: number } {
  const start = index * plan.chunkSize;
  return { start, end: index === plan.count - 1 ? size : start + plan.chunkSize };
}

/**
 * Whether an address is one of TikTok's upload addresses: the chunk route
 * forwards to the address the page names, so it forwards to TikTok and
 * nowhere else.
 */
export function isTikTokUploadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    return parsed.protocol === 'https:' && (host === 'tiktokapis.com' || host.endsWith('.tiktokapis.com'));
  } catch {
    return false;
  }
}

/** Why sending to TikTok stopped, as something to say rather than an error code. */
export type TikTokFailure = 'signin' | 'popup' | 'pending' | 'rate' | 'size' | 'rejected' | 'network' | 'other';

/** TikTok's `error.code` (from its `{ data, error: { code } }` envelope) or OAuth `error`, as one of the failures above. */
export function tiktokFailure(status: number, code?: string): TikTokFailure {
  if (status === 401 || code === 'access_token_invalid' || code === 'scope_not_authorized' || code === 'signin') return 'signin';
  if (code === 'spam_risk_too_many_pending_share') return 'pending';
  if (status === 429 || code === 'rate_limit_exceeded' || code === 'spam_risk_too_many_posts') return 'rate';
  if (code === 'file_format_check_failed' || code === 'duration_check_failed' || code === 'frame_rate_check_failed' ||
      code === 'picture_size_check_failed' || code === 'size') return 'size';
  if (code?.startsWith('spam_risk') || code === 'publish_cancelled' || code === 'auth_removed') return 'rejected';
  if (status === 0) return 'network';
  return 'other';
}

/** Where a sent video stands at TikTok: still being taken in, in the person's inbox, posted, or failed. */
export type DraftStatus = 'processing' | 'inbox' | 'posted' | 'failed';

export function draftStatus(status: string | undefined): DraftStatus {
  if (status === 'SEND_TO_USER_INBOX') return 'inbox';
  if (status === 'PUBLISH_COMPLETE') return 'posted';
  if (status === 'FAILED') return 'failed';
  return 'processing';
}
