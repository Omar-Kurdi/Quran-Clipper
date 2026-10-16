import { describe, it, expect } from 'vitest';
import { normalizeEdit, NO_EDIT } from './audioEdit';
import { editGraph, measuredLoudness } from './audioRender';

describe('the ffmpeg graph for an edit', () => {
  it('passes the recording through untouched when only asked to', () => {
    expect(editGraph(NO_EDIT, 10, { rubberband: true })).toBe('[0:a]anull[out]');
  });

  it('keeps what is between the cuts, fading only at the joins, end to end', () => {
    const graph = editGraph(normalizeEdit({ cuts: [{ start: 0, end: 1 }, { start: 4, end: 5 }] }), 10, { rubberband: true });
    expect(graph).toBe(
      '[0:a]atrim=start=1.0000:end=4.0000,asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st=2.9900:d=0.01[k0];' +
      '[0:a]atrim=start=5.0000,asetpts=PTS-STARTPTS,afade=t=in:d=0.01[k1];' +
      '[k0][k1]concat=n=2:v=0:a=1[cut];[cut]anull[out]'
    );
  });

  it('keeps nothing after a cut to the end, however the file measures', () => {
    const graph = editGraph(normalizeEdit({ cuts: [{ start: 8, end: 10 }] }), 10, { rubberband: true });
    expect(graph).toContain('concat=n=1');
    expect(graph).not.toContain('start=10');
  });

  it('cleans up, then speeds up without the pitch moving, then measures the loudness', () => {
    const edit = normalizeEdit({ tempo: 1.15, loudness: true, denoise: true });
    expect(editGraph(edit, 10, { rubberband: true })).toBe(
      '[0:a]highpass=f=60,afftdn=nr=12:nf=-50:tn=1,rubberband=tempo=1.15:pitchq=quality,loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json[out]'
    );
    expect(editGraph(edit, 10, { rubberband: false })).toContain('atempo=1.15');
  });

  it('applies the measured loudness as one gain', () => {
    const stderr = 'noise\n{\n\t"input_i" : "-12.72",\n\t"input_tp" : "-0.71",\n\t"input_lra" : "8.70",\n\t"input_thresh" : "-23.64",\n\t"target_offset" : "-0.23"\n}\n';
    const measured = measuredLoudness(stderr)!;
    expect(editGraph(normalizeEdit({ loudness: true }), 10, { rubberband: true, measured }))
      .toContain('measured_I=-12.72:measured_TP=-0.71:measured_LRA=8.70:measured_thresh=-23.64:offset=-0.23:linear=true');
    expect(measuredLoudness('{"input_i" : "-inf", "input_tp": "-inf", "input_lra": "0", "input_thresh": "-inf", "target_offset": "0"}')).toBeNull();
  });
});

describe('a loop-friendly ending in the graph', () => {
  it('fades both ends and pads with silence, after everything else', () => {
    const graph = editGraph(normalizeEdit({ tempo: 1.1, loop: true }), 10, { rubberband: true });
    expect(graph).toBe('[0:a]rubberband=tempo=1.1:pitchq=quality,afade=t=in:d=0.1,areverse,afade=t=in:d=0.15,areverse,apad=pad_dur=0.5[out]');
  });
});
