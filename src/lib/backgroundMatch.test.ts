import { describe, it, expect } from 'vitest';
import {
  BACKGROUND_QUERIES, LENGTH_MARGIN_SEC, builtInCandidates, chooseBackground, leastLength, sample, searchOrientation
} from './backgroundMatch';

const video = (seconds: number) => ({ url: `https://videos.example/${seconds}.mp4`, seconds });
const first = () => 0;
const last = () => 0.999;

describe('chooseBackground', () => {
  const pool = [10, 25, 33, 40, 41, 60, 120].map(video);

  it('picks among the nearest that are long enough, never a short one or a far longer one', () => {
    // A 30 s clip needs 32 s: 33, 40, 41 and 60 are the nearest four; 120 is not among them.
    expect(chooseBackground(pool, 30, first)?.seconds).toBe(33);
    expect(chooseBackground(pool, 30, last)?.seconds).toBe(60);
    const seen = new Set(Array.from({ length: 50 }, (_, i) => chooseBackground(pool, 30, () => i / 50)?.seconds));
    expect([...seen].sort((a, b) => a! - b!)).toEqual([33, 40, 41, 60]);
  });

  it('takes the longest, to loop, when none is long enough', () => {
    expect(chooseBackground(pool, 200, first)?.seconds).toBe(120);
  });

  it('chooses from fewer when fewer are long enough', () => {
    expect(chooseBackground(pool, 100, last)?.seconds).toBe(120);
  });

  it('counts a video twice offered once, and none for nothing', () => {
    expect(chooseBackground([video(40), video(40)], 30, last)?.seconds).toBe(40);
    expect(chooseBackground([], 30)).toBeNull();
  });

  it('asks for the margin beyond the clip, so a video as long as the clip is not chosen to loop', () => {
    expect(leastLength(30)).toBe(30 + LENGTH_MARGIN_SEC);
    expect(chooseBackground([video(30), video(90)], 30, first)?.seconds).toBe(90);
  });
});

describe('searchOrientation', () => {
  it('follows the frame', () => {
    expect(searchOrientation('9:16')).toBe('portrait');
    expect(searchOrientation('4:5')).toBe('portrait');
    expect(searchOrientation('16:9')).toBe('landscape');
    expect(searchOrientation('1:1')).toBe('square');
  });
});

describe('sample', () => {
  it('takes each at most once', () => {
    const picked = sample(BACKGROUND_QUERIES, 3, () => 0.5);
    expect(new Set(picked).size).toBe(3);
    expect(sample(['a'], 3)).toEqual(['a']);
  });
});

describe('builtInCandidates', () => {
  it('offers every built-in with its length', () => {
    const builtIns = builtInCandidates();
    expect(builtIns.length).toBe(11);
    expect(Math.max(...builtIns.map(c => c.seconds))).toBe(40.8);
  });
});
