import { describe, it, expect } from 'vitest';
import { libraryOf, type LibraryProject } from './projectLibrary';

const verses = [
  { verseKey: '2:201', startTime: 0, endTime: 10 },
  { verseKey: '2:202', startTime: 10, endTime: 20 },
  { verseKey: '2:203', startTime: 20, endTime: 30 },
];
const upload = (id: string, updatedAt: string, clips: unknown): LibraryProject => ({
  id, title: id, surahNumber: 2, surahNameEnglish: 'Al-Baqarah', ayahStart: 201, ayahEnd: 203,
  audioFileName: 'baqarah.mp3', audioKey: 'key-1', clips, versesJson: verses, updatedAt,
});

describe('libraryOf', () => {
  it('lists one recording per uploaded file, with its clips in play order and their ayahs', () => {
    const { recordings } = libraryOf([
      upload('proj_a', '2026-11-01', [{ id: 'c2', start: 21, end: 29, style: null }, { id: 'c1', start: 1, end: 19, style: null }]),
    ], [{ projectId: 'proj_a', clipId: 'c1' }]);
    expect(recordings).toHaveLength(1);
    expect(recordings[0].kind).toBe('upload');
    expect(recordings[0].clips.map(c => [c.clipId, c.number, c.first, c.last, c.exported])).toEqual([
      ['c1', 1, 201, 202, true],
      ['c2', 2, 203, 203, false],
    ]);
  });

  it('marks across the whole surah which ayahs each clip holds', () => {
    const { recordings } = libraryOf([upload('proj_a', '2026-11-01', [{ id: 'c1', start: 1, end: 19, style: null }])], []);
    expect(recordings[0].coverage).toHaveLength(286);
    expect(recordings[0].coverage[200]).toEqual([1]);
    expect(recordings[0].coverage[201]).toEqual([1]);
    expect(recordings[0].coverage[202]).toEqual([]);
  });

  it('groups the projects saved from one file, the last edited opening it', () => {
    const { recordings } = libraryOf([
      upload('proj_old', '2026-10-01', []),
      upload('proj_new', '2026-11-01', []),
    ], []);
    expect(recordings).toHaveLength(1);
    expect(recordings[0].project.id).toBe('proj_new');
  });

});

describe('libraryOf, an upload by its tag', () => {
  it("names an upload's reciter from its file's tag", () => {
    const tagged = { ...upload('proj_a', '2026-11-01', []), audioTags: { artist: 'علاء عقل', track: 49 } };
    expect(libraryOf([tagged], []).recordings[0].artist).toBe('علاء عقل');
    expect(libraryOf([upload('proj_b', '2026-11-01', [])], []).recordings[0].artist).toBe('');
  });

  it("keeps two reciters' files of one name apart once their stored copies are gone", () => {
    const of = (id: string, artist: string): LibraryProject => ({ ...upload(id, '2026-11-01', []), audioKey: '', audioTags: { artist } });
    expect(libraryOf([of('proj_a', 'One'), of('proj_b', 'Two')], []).recordings).toHaveLength(2);
    expect(libraryOf([of('proj_a', 'One'), of('proj_b', 'One')], []).recordings).toHaveLength(1);
  });
});

describe("libraryOf, a built-in reciter's surah", () => {
  it("lists a built-in reciter's surah as one recording, each passage a clip", () => {
    const reciter = (id: string, start: number, end: number, updatedAt: string): LibraryProject => ({
      id, title: id, surahNumber: 67, surahNameEnglish: 'Al-Mulk', ayahStart: start, ayahEnd: end,
      reciterId: 'qf-3', reciterName: 'A reciter', updatedAt,
    });
    const { recordings, latestClips } = libraryOf(
      [reciter('proj_1', 1, 4, '2026-11-01'), reciter('proj_2', 10, 12, '2026-11-02')],
      [{ projectId: 'proj_2', clipId: '' }]
    );
    expect(recordings).toHaveLength(1);
    expect(recordings[0].kind).toBe('reciter');
    expect(recordings[0].clips.map(c => [c.projectId, c.number, c.exported])).toEqual([['proj_1', 1, false], ['proj_2', 2, true]]);
    expect(latestClips[0].projectId).toBe('proj_2');
  });

  it("lists the clips a reciter's passage was cut into, rather than the passage", () => {
    const { recordings } = libraryOf([{
      id: 'proj_r', title: 'r', surahNumber: 2, surahNameEnglish: 'Al-Baqarah', ayahStart: 201, ayahEnd: 203,
      reciterId: 'qf-3', reciterName: 'A reciter', versesJson: verses, updatedAt: '2026-11-01',
      clips: [{ id: 'c1', start: 1, end: 19, style: null }, { id: 'c2', start: 21, end: 29, style: null }],
    }], []);
    expect(recordings[0].kind).toBe('reciter');
    expect(recordings[0].clips.map(c => [c.clipId, c.first, c.last])).toEqual([['c1', 201, 202], ['c2', 203, 203]]);
  });
});
