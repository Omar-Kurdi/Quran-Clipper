import { describe, expect, it } from 'vitest';
import { folderOf, folderRecordings } from '@/components/FolderPicker';

const inFolder = (path: string, type = 'audio/mpeg') => {
  const file = new File(['x'], path.split('/').pop()!, { type });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
};

describe('folderOf', () => {
  it('is the folder a picked file sits in', () => {
    expect(folderOf(inFolder('Alaa-Aqel/026.mp3'))).toBe('Alaa-Aqel');
    expect(folderOf(inFolder('MP3/Abdulbasit/026.mp3'))).toBe('MP3/Abdulbasit');
  });

  it('is empty for a file not picked by its folder', () => {
    expect(folderOf(new File(['x'], '026.mp3'))).toBe('');
  });
});

describe('folderRecordings', () => {
  it('lists the recordings only, in surah order', () => {
    const files = [inFolder('A/110.mp3'), inFolder('A/cover.jpg', 'image/jpeg'), inFolder('A/9.mp3'), inFolder('A/026.mp3')];
    const listed = folderRecordings(files, file => file.type.startsWith('audio'));
    expect(listed.map(each => each.file.name)).toEqual(['9.mp3', '026.mp3', '110.mp3']);
    expect(listed.every(each => each.folder === 'A')).toBe(true);
  });
});
