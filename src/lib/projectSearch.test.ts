import { describe, it, expect } from 'vitest';
import { matchesProject, projectLength, renderedShapes, type ProjectRow } from './projectSearch';

const row: ProjectRow = {
  id: 'p1', title: 'Friday reminder', surahNumber: 18, surahNameArabic: 'الكهف', surahNameEnglish: 'Al-Kahf',
  ayahStart: 1, ayahEnd: 5, reciterName: 'Maher Al-Muaiqly', audioFileName: 'kahf-friday.m4a', updatedAt: '2026-10-01'
};

describe('matchesProject', () => {
  it('matches everything on an empty search', () => {
    expect(matchesProject(row, '  ')).toBe(true);
  });

  it('finds a clip by title, surah in either language, reciter or file, ignoring case', () => {
    for (const q of ['friday', 'KAHF', 'الكهف', 'muaiqly', '.m4a']) expect(matchesProject(row, q)).toBe(true);
  });

  it('finds a clip by its reference', () => {
    expect(matchesProject(row, '18:1')).toBe(true);
    expect(matchesProject(row, '67:')).toBe(false);
  });
});

describe('renderedShapes', () => {
  it('lists each shape this project was rendered in, once, in order', () => {
    const exports = [
      { projectId: 'p1', aspectRatio: '9:16' }, { projectId: 'p2', aspectRatio: '16:9' },
      { projectId: 'p1', aspectRatio: '1:1' }, { projectId: 'p1', aspectRatio: '9:16' }
    ];
    expect(renderedShapes(exports, 'p1')).toEqual(['9:16', '1:1']);
    expect(renderedShapes(exports, 'p3')).toEqual([]);
  });
});

describe('projectLength', () => {
  it('reads the length as it is saved, `2:05` text, which as a number was nothing and showed none', () => {
    expect(projectLength('2:05')).toBe('2:05');
    expect(projectLength('12:40')).toBe('12:40');
  });

  it('reads rows saved as seconds, and shows none for an empty length', () => {
    expect(projectLength(125)).toBe('2:05');
    expect(projectLength('125')).toBe('2:05');
    expect(projectLength('0:00')).toBeNull();
    expect(projectLength(0)).toBeNull();
    expect(projectLength(null)).toBeNull();
    expect(projectLength('')).toBeNull();
  });
});
