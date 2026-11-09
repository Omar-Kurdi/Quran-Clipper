import { describe, it, expect } from 'vitest';
import {
  addJob, addJobs, cancelAll, moveJob, newJob, nextJob, queueBusy, removeJob, updateJob, withAspect, withClip, type ExportJob
} from './exportQueue';

const job = (presetId: string, aspectRatio = '9:16') => newJob({ presetId, aspectRatio, tier: 'standard', fps: 30 });

/** Three jobs: the first done, the second rendering, two waiting. */
function midway(): ExportJob[] {
  const [a, b, c, d] = [job('reels'), job('youtube', '16:9'), job('square', '1:1'), job('portrait', '4:5')];
  return [{ ...a, status: 'done' }, { ...b, status: 'rendering' }, c, d];
}

describe('addJob', () => {
  it('adds in order', () => {
    const jobs = addJob(addJob([], job('reels')), job('youtube'));
    expect(jobs.map(j => j.presetId)).toEqual(['reels', 'youtube']);
  });

  it('does not queue the same render twice', () => {
    const once = addJob([], job('reels'));
    expect(addJob(once, job('reels'))).toBe(once);
  });

  it('queues the same render of two clips as two renders', () => {
    const first = newJob({ presetId: 'reels', aspectRatio: '9:16', tier: 'standard', fps: 30, clipId: 'a' });
    const second = newJob({ presetId: 'reels', aspectRatio: '9:16', tier: 'standard', fps: 30, clipId: 'b' });
    expect(addJob(addJob([], first), second)).toHaveLength(2);
  });

  it('does not queue the same render of one clip twice', () => {
    const once = addJob([], newJob({ presetId: 'reels', aspectRatio: '9:16', tier: 'standard', fps: 30, clipId: 'a' }));
    expect(addJob(once, newJob({ presetId: 'reels', aspectRatio: '9:16', tier: 'standard', fps: 30, clipId: 'a' }))).toBe(once);
  });

  it('does queue it again once the first has run', () => {
    const ran = [{ ...job('reels'), status: 'done' as const }];
    expect(addJob(ran, job('reels'))).toHaveLength(2);
  });
});

describe('addJobs', () => {
  const input = (presetId: string, aspectRatio = '9:16') => ({ presetId, aspectRatio, tier: 'standard' as const, fps: 30 });

  it('queues one render per destination, in the order given', () => {
    const jobs = addJobs([], [input('shorts'), input('ig-feed', '1:1')]);
    expect(jobs.map(j => [j.presetId, j.status])).toEqual([['shorts', 'queued'], ['ig-feed', 'queued']]);
  });

  it('still refuses a render that is already waiting', () => {
    const once = addJobs([], [input('shorts')]);
    expect(addJobs(once, [input('shorts'), input('reels')]).map(j => j.presetId)).toEqual(['shorts', 'reels']);
  });
});

describe('moving and removing', () => {
  it('reorders only the waiting jobs', () => {
    const jobs = midway();
    const moved = moveJob(jobs, jobs[3].id, -1);
    expect(moved.map(j => j.presetId)).toEqual(['reels', 'youtube', 'portrait', 'square']);
  });

  it('will not move a waiting job ahead of the one rendering', () => {
    const jobs = midway();
    expect(moveJob(jobs, jobs[2].id, -1)).toBe(jobs);
  });

  it('removes a waiting job but not the running one', () => {
    const jobs = midway();
    expect(removeJob(jobs, jobs[3].id)).toHaveLength(3);
    expect(removeJob(jobs, jobs[1].id)).toHaveLength(4);
  });
});

describe('running', () => {
  it('runs the waiting jobs in order', () => {
    const jobs = midway();
    expect(nextJob(jobs)?.presetId).toBe('square');
    expect(queueBusy(jobs)).toBe(true);
    expect(queueBusy(updateJob(jobs, jobs[1].id, { status: 'done' }))).toBe(false);
  });

  it('stops everything unfinished when cancelled, and keeps what is done', () => {
    const cancelled = cancelAll(midway());
    expect(cancelled.map(j => j.status)).toEqual(['done', 'cancelled', 'cancelled', 'cancelled']);
    expect(nextJob(cancelled)).toBeUndefined();
  });
});

describe('withAspect', () => {
  it('tags each file with its shape, so a queue does not overwrite itself', () => {
    expect(withAspect('Al-Fatihah_1_1-7.mp4', '9:16')).toBe('Al-Fatihah_1_1-7_9x16.mp4');
    expect(withAspect('clip', '1:1')).toBe('clip_1x1');
  });
});

describe('withClip', () => {
  it('numbers a clip of a recording into its file name', () => {
    expect(withClip('Al-Baqarah_2_4-9_9x16.mp4', 2)).toBe('Al-Baqarah_2_4-9_9x16_clip-2.mp4');
  });

  it('leaves a render of no clip as it was', () => {
    expect(withClip('Al-Baqarah_2_4-9.mp4', undefined)).toBe('Al-Baqarah_2_4-9.mp4');
  });
});
