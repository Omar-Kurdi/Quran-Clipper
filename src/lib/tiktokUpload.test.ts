import { describe, it, expect } from 'vitest';
import { chunkPlan, chunkRange, draftStatus, isTikTokUploadUrl, tiktokFailure, TIKTOK_CHUNK } from './tiktokUpload';

const MB = 1024 * 1024;

describe('chunkPlan', () => {
  it('sends a file of one chunk or less whole, as TikTok asks of anything under 5 MB', () => {
    expect(chunkPlan(3 * MB)).toEqual({ chunkSize: 3 * MB, count: 1 });
    expect(chunkPlan(TIKTOK_CHUNK)).toEqual({ chunkSize: TIKTOK_CHUNK, count: 1 });
  });

  it('cuts a larger file into whole chunks, the remainder joining the last', () => {
    const size = 50 * MB + 123;
    const plan = chunkPlan(size);
    expect(plan).toEqual({ chunkSize: TIKTOK_CHUNK, count: 3 });
    const ranges = [0, 1, 2].map(i => chunkRange(i, plan, size));
    expect(ranges[0]).toEqual({ start: 0, end: TIKTOK_CHUNK });
    expect(ranges[2]).toEqual({ start: 2 * TIKTOK_CHUNK, end: size });
    // Every byte once, and the last piece within TikTok's 128 MB.
    expect(ranges.reduce((sum, r) => sum + r.end - r.start, 0)).toBe(size);
    expect(ranges[2].end - ranges[2].start).toBeLessThan(2 * TIKTOK_CHUNK);
  });

  it('keeps a file just under two chunks as one piece, within 5 to 64 MB', () => {
    const plan = chunkPlan(2 * TIKTOK_CHUNK - 1);
    expect(plan.count).toBe(1);
    expect(chunkRange(0, plan, 2 * TIKTOK_CHUNK - 1)).toEqual({ start: 0, end: 2 * TIKTOK_CHUNK - 1 });
  });
});

describe('isTikTokUploadUrl', () => {
  it('takes only https addresses on TikTok\'s API domain', () => {
    expect(isTikTokUploadUrl('https://open-upload.tiktokapis.com/video/?upload_id=1&upload_token=x')).toBe(true);
    expect(isTikTokUploadUrl('http://open-upload.tiktokapis.com/video/')).toBe(false);
    expect(isTikTokUploadUrl('https://tiktokapis.com.evil.example/')).toBe(false);
    expect(isTikTokUploadUrl('https://eviltiktokapis.com/')).toBe(false);
    expect(isTikTokUploadUrl('https://127.0.0.1/')).toBe(false);
    expect(isTikTokUploadUrl('not a url')).toBe(false);
  });
});

describe('tiktokFailure', () => {
  it('reads TikTok\'s error codes as something to say', () => {
    expect(tiktokFailure(401, 'access_token_invalid')).toBe('signin');
    expect(tiktokFailure(403, 'spam_risk_too_many_pending_share')).toBe('pending');
    expect(tiktokFailure(429, 'rate_limit_exceeded')).toBe('rate');
    expect(tiktokFailure(200, 'duration_check_failed')).toBe('size');
    expect(tiktokFailure(200, 'spam_risk_text')).toBe('rejected');
    expect(tiktokFailure(0)).toBe('network');
    expect(tiktokFailure(500, 'internal_error')).toBe('other');
  });
});

describe('draftStatus', () => {
  it('names where a sent draft stands', () => {
    expect(draftStatus('PROCESSING_UPLOAD')).toBe('processing');
    expect(draftStatus('SEND_TO_USER_INBOX')).toBe('inbox');
    expect(draftStatus('PUBLISH_COMPLETE')).toBe('posted');
    expect(draftStatus('FAILED')).toBe('failed');
    expect(draftStatus(undefined)).toBe('processing');
  });
});
