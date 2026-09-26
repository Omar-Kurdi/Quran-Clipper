import { describe, it, expect } from 'vitest';
import type { VideoCanvasConfig } from '@/components/VideoCanvas';
import { inputUrl, isInputName, isRenderId, muxArgs, parseRenderSpec, withInputUrls, withUploads } from './serverRender';

const config = (patch: Partial<VideoCanvasConfig>) => ({ bgUrl: '', bgUrls: [], bgSegments: [], ...patch }) as VideoCanvasConfig;

describe('withUploads', () => {
  it('replaces every blob url, wherever it sits, and uploads each once', () => {
    const { config: out, uploads } = withUploads(
      config({
        bgUrl: 'blob:a',
        bgUrls: ['blob:a', 'https://videos.example/b.mp4', 'blob:c'],
        bgSegments: [{ url: 'blob:c', start: 0, end: 2 } as never],
      }),
      url => (url === 'blob:c' ? 'image' : 'video')
    );
    expect(out.bgUrl).toBe('render-input:bg-0');
    expect(out.bgUrls).toEqual(['render-input:bg-0', 'https://videos.example/b.mp4', 'render-input:bg-1']);
    expect(out.bgSegments?.[0].url).toBe('render-input:bg-1');
    expect(uploads).toEqual([
      { url: 'blob:a', media: { name: 'bg-0', kind: 'video' } },
      { url: 'blob:c', media: { name: 'bg-1', kind: 'image' } },
    ]);
  });

  it('leaves a project with nothing uploaded as it was', () => {
    const plain = config({ bgUrl: 'https://videos.example/a.mp4' });
    const { config: out, uploads } = withUploads(plain, () => 'video');
    expect(out.bgUrl).toBe(plain.bgUrl);
    expect(uploads).toEqual([]);
  });
});

describe('withInputUrls', () => {
  it('points input names at the worker and leaves web urls alone', () => {
    const out = withInputUrls(config({ bgUrl: 'render-input:bg-0', bgUrls: ['https://x.example/a.jpg'] }), 'r_abc123', 'k1');
    expect(out.bgUrl).toBe(inputUrl('r_abc123', 'k1', 'bg-0'));
    expect(out.bgUrls).toEqual(['https://x.example/a.jpg']);
  });
});

describe('names that reach a path', () => {
  it('accepts only ids and inputs the server made', () => {
    expect(isRenderId('r_mu7x7gj35b0e7954')).toBe(true);
    for (const bad of ['../etc', 'r_', 'r_ABC123', 'r_abc/../x', '']) expect(isRenderId(bad)).toBe(false);
    expect(isInputName('audio')).toBe(true);
    expect(isInputName('bg-12')).toBe(true);
    for (const bad of ['job.json', '../audio', 'bg-', 'spec.json']) expect(isInputName(bad)).toBe(false);
  });
});

describe('muxArgs', () => {
  it('copies the picture and cuts the recording to the clip', () => {
    const args = muxArgs({ video: 'p.mp4', audio: 'a', start: 12.5, end: 48.25, output: 'o.mp4' });
    expect(args.join(' ')).toContain('-i p.mp4 -ss 12.500 -t 35.750 -i a');
    expect(args.join(' ')).toContain('-c:v copy -c:a aac');
    expect(args.at(-1)).toBe('o.mp4');
  });
});

describe('parseRenderSpec', () => {
  const valid = {
    config: {}, verses: [], media: [{ name: 'bg-0', kind: 'image' }],
    plan: { width: 1080, height: 1920, fps: 60, bitrate: 12_000_000 },
    range: { start: 2, end: 38 }, fileName: 'a.mp4', title: 'A',
  };

  it('accepts a description the studio would send', () => {
    expect(parseRenderSpec(JSON.stringify(valid))).toEqual(valid);
    const linked = { ...valid, projectId: 'proj_1790410746589_belrg' };
    expect(parseRenderSpec(JSON.stringify(linked))).toEqual(linked);
  });

  it('refuses what an encoder, a path or a range could not take', () => {
    const broken = [
      'not json',
      { ...valid, plan: { ...valid.plan, width: 100_000 } },
      { ...valid, plan: { ...valid.plan, fps: 0 } },
      { ...valid, range: { start: 10, end: 10 } },
      { ...valid, media: [{ name: '../job.json', kind: 'image' }] },
      { ...valid, media: [{ name: 'audio', kind: 'video' }] },
      { ...valid, media: [{ name: 'bg-0', kind: 'script' }] },
      { ...valid, fileName: 7 },
      { ...valid, verses: 'none' },
      { ...valid, projectId: "x'); drop table projects; --" },
      { ...valid, projectId: 42 },
    ];
    for (const body of broken) {
      expect(parseRenderSpec(typeof body === 'string' ? body : JSON.stringify(body))).toBeNull();
    }
  });
});
