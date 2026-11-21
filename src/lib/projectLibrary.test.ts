import { describe, it, expect } from 'vitest';
import { asLibraryProjects, clipTabLabel, familyOf, libraryOf, type LibraryProject } from './projectLibrary';

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

describe('libraryOf, dates and folders', () => {
  const made = Date.UTC(2026, 10, 18, 6, 30);
  const clips = [{ id: `clip-${made.toString(36)}-1`, start: 1, end: 19, style: null }, { id: 'c2', start: 21, end: 29, style: null }];

  it("gives each clip when it was made -- its own time, else its project's -- and when it was last exported", () => {
    const project = { ...upload('proj_a', '2026-11-18T08:00:00.000Z', clips), createdAt: '2026-11-17T20:00:00.000Z' };
    const { recordings } = libraryOf([project], [
      { projectId: 'proj_a', clipId: 'c2', exportedAt: '2026-11-18T07:00:00.000Z' },
    ]);
    expect(recordings[0].clips.map(c => [c.clipId, c.madeAt, c.exported, c.exportedAt])).toEqual([
      [clips[0].id, new Date(made).toISOString(), false, null],
      ['c2', '2026-11-17T20:00:00.000Z', true, '2026-11-18T07:00:00.000Z'],
    ]);
  });

  it('counts an export on record without a time as exported', () => {
    const { recordings } = libraryOf([upload('proj_a', '2026-11-01', clips)], [{ projectId: 'proj_a', clipId: 'c2' }]);
    expect(recordings[0].clips[1]).toMatchObject({ exported: true, exportedAt: null });
  });

  it("dates a recording from its first project's making to its last edit", () => {
    const { recordings } = libraryOf([
      { ...upload('proj_new', '2026-11-18', []), createdAt: '2026-11-10' },
      { ...upload('proj_old', '2026-11-12', []), createdAt: '2026-11-01' },
    ], []);
    expect([recordings[0].createdAt, recordings[0].updatedAt]).toEqual(['2026-11-01', '2026-11-18']);
  });

  it('names the folder an upload was picked from', () => {
    const picked = { ...upload('proj_a', '2026-11-01', []), audioTags: { folder: 'Alaa-Aqel' } };
    expect(libraryOf([picked], []).recordings[0].folder).toBe('Alaa-Aqel');
    expect(libraryOf([upload('proj_b', '2026-11-01', [])], []).recordings[0].folder).toBe('');
  });
});

describe('libraryOf, clips saved as projects of their own', () => {
  const source = 'a'.repeat(64);
  const recording: LibraryProject = {
    ...upload('proj_rec', '2026-11-20T10:00:00Z', []), audioKey: 'key-rec', audioTags: { source }, trimWindow: null,
  };
  const clip = (id: string, updatedAt: string, ayahStart: number, ayahEnd: number): LibraryProject => ({
    ...upload(id, updatedAt, []), audioKey: `key-${id}`, audioTags: { source, clip: true }, trimWindow: { start: 10, end: 30 },
    ayahStart, ayahEnd, createdAt: updatedAt,
  });

  it('lists each clip project under the recording it was cut from, which opens as the recording', () => {
    const { recordings } = libraryOf([
      recording,
      clip('proj_c2', '2026-11-21T10:00:00Z', 203, 203),
      clip('proj_c1', '2026-11-20T11:00:00Z', 201, 202),
    ], [{ projectId: 'proj_c1', clipId: '' }]);
    expect(recordings).toHaveLength(1);
    // Edited most recently through a clip, but the recording is what opens.
    expect(recordings[0].project.id).toBe('proj_rec');
    expect(recordings[0].updatedAt).toBe('2026-11-21T10:00:00Z');
    expect(recordings[0].clips.map(c => [c.projectId, c.clipId, c.number, c.first, c.last, c.exported])).toEqual([
      ['proj_c1', null, 1, 201, 202, true],
      ['proj_c2', null, 2, 203, 203, false],
    ]);
  });

  it('keeps a trimmed upload with no source as the recording it always was', () => {
    const trimmed: LibraryProject = { ...upload('proj_t', '2026-11-01', []), trimWindow: { start: 5, end: 25 } };
    const { recordings } = libraryOf([trimmed], []);
    expect(recordings[0].project.id).toBe('proj_t');
    expect(recordings[0].clips).toEqual([]);
  });
});

describe("libraryOf, the old layout's windows made projects", () => {
  const source = 'a'.repeat(64);
  const clip = (id: string, updatedAt: string, ayahStart: number, ayahEnd: number): LibraryProject => ({
    ...upload(id, updatedAt, []), audioKey: `key-${id}`, audioTags: { source, clip: true }, trimWindow: { start: 10, end: 30 },
    ayahStart, ayahEnd, createdAt: updatedAt,
  });

  it("lists the old layout's window once made a project, as that project, with the window's render", () => {
    const windows = [{ id: 'c1', start: 1, end: 19, style: null }, { id: 'c2', start: 21, end: 29, style: null }];
    const original: LibraryProject = { ...upload('proj_old', '2026-11-10', windows), audioTags: { source }, trimWindow: { start: 100, end: 200 } };
    // A copy of the project, with the same windows, and the window c1 made a project from it.
    const twin: LibraryProject = { ...upload('proj_twin', '2026-11-09', windows), audioTags: { source }, trimWindow: { start: 100, end: 200 } };
    const made: LibraryProject = {
      ...clip('proj_made', '2026-11-21T10:00:00Z', 201, 202), trimWindow: { start: 101, end: 119 },
      audioTags: { source, clip: true, windowOf: 'proj_old/c1' },
    };
    const { recordings } = libraryOf([original, twin, made], [{ projectId: 'proj_old', clipId: 'c1', exportedAt: '2026-11-11T00:00:00Z' }]);
    expect(recordings).toHaveLength(1);
    // Trimmed, but no clip: the recording, opened as such.
    expect(recordings[0].project.id).toBe('proj_old');
    expect(recordings[0].clips.map(c => [c.projectId, c.clipId, c.exportedAt])).toEqual([
      ['proj_made', null, '2026-11-11T00:00:00Z'],
      ['proj_old', 'c2', null],
      ['proj_twin', 'c2', null],
    ]);
  });
});

describe('familyOf, the studio\'s tabs', () => {
  const source = 'b'.repeat(64);
  const row = (id: string, updatedAt: string, extra: Partial<LibraryProject>): LibraryProject => ({
    ...upload(id, updatedAt, []), audioTags: { source }, ...extra,
  });

  it('gives the recording last edited and its clips in the order they play, nothing of another recording', () => {
    const projects = [
      row('proj_c2', '2026-11-21T03:00:00Z', { audioTags: { source, clip: true }, trimWindow: { start: 300, end: 360 } }),
      row('proj_rec_old', '2026-11-19T00:00:00Z', {}),
      row('proj_c1', '2026-11-21T02:00:00Z', { audioTags: { source, clip: true }, trimWindow: { start: 100, end: 160 } }),
      row('proj_rec', '2026-11-20T00:00:00Z', {}),
      row('proj_other', '2026-11-21T04:00:00Z', { audioTags: { source: 'c'.repeat(64), clip: true }, trimWindow: { start: 0, end: 10 } }),
    ];
    const family = familyOf(projects, source);
    expect(family.recording?.id).toBe('proj_rec');
    expect(family.clips.map(clip => clip.id)).toEqual(['proj_c1', 'proj_c2']);
  });

  it('has no recording when only its clips are saved', () => {
    const family = familyOf([row('proj_c1', '2026-11-21', { audioTags: { source, clip: true }, trimWindow: { start: 1, end: 9 } })], source);
    expect(family.recording).toBeNull();
    expect(family.clips).toHaveLength(1);
  });
});

describe('asLibraryProjects and clipTabLabel', () => {
  it('keeps only rows that are projects', () => {
    const good = upload('proj_a', '2026-11-21', []);
    expect(asLibraryProjects([good, null, { id: 'x' }, 'row'])).toEqual([good]);
  });

  it("names a clip's tab by its ayahs, and nothing while it has no captions", () => {
    expect(clipTabLabel({ surahNumber: 3, ayahStart: 14, ayahEnd: 15, versesJson: [{}] })).toBe('3:14–15');
    expect(clipTabLabel({ surahNumber: 3, ayahStart: 30, ayahEnd: 30, versesJson: [{}] })).toBe('3:30');
    expect(clipTabLabel({ surahNumber: 3, ayahStart: 1, ayahEnd: 7, versesJson: [] })).toBe('');
  });
});
