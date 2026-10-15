import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { qfPassage, qfPassageOf, qfPassageUrl } from './qfRecitations';

describe('qfPassageUrl and qfPassageOf', () => {
  it('names a passage and reads it back, from any origin', () => {
    const url = qfPassageUrl('qf-4', 12, 46, 47);
    expect(qfPassageOf(url)).toEqual({ reciterId: 'qf-4', surah: 12, start: 46, end: 47 });
    expect(qfPassageOf(`https://quran.okurdi.com${url}`)?.reciterId).toBe('qf-4');
  });

  it('reads nothing else: an excluded or unknown reciter, a range out of order, another path', () => {
    // Mishari al-Afasy (QF 7) is excluded, so never a reciter here.
    expect(qfPassageOf('/api/audio/ayahs?reciter=qf-7&surah=1&start=1&end=7')).toBeNull();
    expect(qfPassageOf('/api/audio/ayahs?reciter=qf-4&surah=115&start=1&end=2')).toBeNull();
    expect(qfPassageOf('/api/audio/ayahs?reciter=qf-4&surah=1&start=3&end=2')).toBeNull();
    expect(qfPassageOf('/api/audio/other?reciter=qf-4&surah=1&start=1&end=2')).toBeNull();
  });
});

describe('qfPassage', () => {
  const saved = process.env.QC_QF_AUDIO_DIR;
  beforeEach(() => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'qc-qf-'));
    mkdirSync(path.join(dir, '4'));
    // Al-Shatri's 1:1-3 as the download writes it: each file's length, and QF's word timings within it.
    writeFileSync(path.join(dir, '4', '001.json'), JSON.stringify({ qfId: 4, surah: 1, ayahs: [
      { ayah: 1, file: '001001.mp3', ms: 6504.49, segments: [[1, 60, 1200], [2, 1210, 2400], [3, 2410, 4000], [4, 4010, 6400]] },
      { ayah: 2, file: '001002.mp3', ms: 5041.633, segments: [[1, 50, 1500], [2, 1510, 2500], [3, 2510, 3500], [4, 3510, 5100]] },
      { ayah: 3, file: '001003.mp3', ms: 4440.816, segments: [[1, 40, 2000], [2, 2010, 4400]] },
    ] }));
    process.env.QC_QF_AUDIO_DIR = dir;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.QC_QF_AUDIO_DIR;
    else process.env.QC_QF_AUDIO_DIR = saved;
  });

  it('starts each ayah where the one before ends, from the files’ own lengths', async () => {
    const passage = (await qfPassage('qf-4', 1, 2, 3))!;
    expect(passage.ayahs.map(a => [a.verseKey, a.start, a.end])).toEqual([['1:2', 0, 5.041633], ['1:3', 5.041633, 9.482449]]);
    expect(passage.totalSeconds).toBeCloseTo(9.482449, 6);
    expect(passage.files.map(file => path.basename(file))).toEqual(['001002.mp3', '001003.mp3']);
  });

  it("puts the words on the passage's clock, never past their own ayah's end", async () => {
    const passage = (await qfPassage('qf-4', 1, 2, 3))!;
    expect(passage.ayahs[1].timing).toEqual({ from: 5042, to: 9482, segments: [[1, 5082, 7042], [2, 7052, 9442]] });
    // Ayah 1's last word runs to 6400 of a 6504ms file; one listed past the end is cut at it.
    const first = (await qfPassage('qf-4', 1, 1, 1))!;
    expect(first.ayahs[0].timing.segments!.at(-1)).toEqual([4, 4010, 6400]);
  });

  it('has nothing for a reciter the studio does not offer', async () => {
    expect(await qfPassage('qf-7', 1, 1, 1)).toBeNull();
  });
});

describe('qfPassage with word timings sent as text', () => {
  const saved = process.env.QC_QF_AUDIO_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.QC_QF_AUDIO_DIR;
    else process.env.QC_QF_AUDIO_DIR = saved;
  });

  it("adds them as numbers (Al-Sudais's 1:1-2 come as \"380\", which joined as strings)", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'qc-qf-'));
    mkdirSync(path.join(dir, '3'));
    writeFileSync(path.join(dir, '3', '001.json'), JSON.stringify({ qfId: 3, surah: 1, ayahs: [
      { ayah: 1, file: '001001.mp3', ms: 3082.449, segments: [['1', '380', '730'], ['4', '740', '3082']] },
      { ayah: 2, file: '001002.mp3', ms: 4493.061, segments: [['1', '420', '1000']] },
    ] }));
    process.env.QC_QF_AUDIO_DIR = dir;
    const passage = (await qfPassage('qf-3', 1, 1, 2))!;
    expect(passage.ayahs[1].timing.segments).toEqual([[1, 3502, 4082]]);
  });
});
