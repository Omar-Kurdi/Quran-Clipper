import { describe, expect, it } from 'vitest';
import { clipMatchForm, postClipMatch, type ClipMatchRequest } from './clipMatch';

const request: ClipMatchRequest = {
  file: new File(['x'], 'baqarah.mp3'), sourceId: 'a'.repeat(64), clip: { start: 3000.5, end: 3061 },
  surah: 2, start: 1, end: 286, reciter: 'r', provider: 'align', breaks: 'normal',
};

describe('clipMatchForm', () => {
  it("names the server's copy and the clip's stretch, not the whole recording", () => {
    const form = clipMatchForm(request, false);
    expect(form.get('sourceId')).toBe(request.sourceId);
    expect(form.get('audio')).toBeNull();
    expect([form.get('windowStart'), form.get('windowEnd')]).toEqual(['3000.5', '3061']);
    expect(form.get('breaks')).toBeNull();
  });

  it('sends the file when told to, or when there is no copy', () => {
    expect(clipMatchForm(request, true).get('audio')).toBeInstanceOf(File);
    expect(clipMatchForm({ ...request, sourceId: undefined }, false).get('sourceId')).toBeNull();
  });
});

describe('postClipMatch', () => {
  it('sends the file again when the server has let its copy go', async () => {
    const sent: FormData[] = [];
    const answers = [new Response('{}', { status: 404 }), new Response('{}', { status: 200 })];
    const res = await postClipMatch(request, async form => { sent.push(form); return answers.shift()!; });
    expect(res.status).toBe(200);
    expect(sent.map(form => form.has('audio'))).toEqual([false, true]);
  });

  it('asks once when the copy is there', async () => {
    let calls = 0;
    await postClipMatch(request, async () => { calls++; return new Response('{}'); });
    expect(calls).toBe(1);
  });
});
