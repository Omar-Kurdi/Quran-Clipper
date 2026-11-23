import { describe, expect, it } from 'vitest';
import { isAwaitedRecording } from './recordingSource';

const YUSUF = '21d64b6def9829829f80956c9bb04e8d377c5d5060dae9f0a29971cc5c5e2448';
const HIJR = 'bcdac934a176068f9b626b77e94f107411bbe5356af975eb328f935d146bf7a9';

describe('isAwaitedRecording', () => {
  it('takes the very recording the project is waiting for', () => {
    expect(isAwaitedRecording({ source: YUSUF, name: 'yusuf.mp3' }, { source: YUSUF, fileName: 'yusuf.mp3' })).toBe(true);
  });

  it('takes it renamed, since its bytes say which recording it is', () => {
    expect(isAwaitedRecording({ source: YUSUF, name: 'renamed.mp3' }, { source: YUSUF, fileName: 'yusuf.mp3' })).toBe(true);
  });

  // Reported: Al-Hijr uploaded while a Yusuf project waited for its audio was
  // taken as Yusuf's, and saved under Yusuf's captions without being matched.
  it('refuses another recording, whatever it is called', () => {
    expect(isAwaitedRecording({ source: HIJR, name: 'hijr.mp3' }, { source: YUSUF, fileName: 'yusuf.mp3' })).toBe(false);
    expect(isAwaitedRecording({ source: HIJR, name: 'yusuf.mp3' }, { source: YUSUF, fileName: 'yusuf.mp3' })).toBe(false);
  });

  it('goes by the file name where either side has no source', () => {
    expect(isAwaitedRecording({ source: HIJR, name: 'yusuf.mp3' }, { source: undefined, fileName: 'yusuf.mp3' })).toBe(true);
    expect(isAwaitedRecording({ source: null, name: 'hijr.mp3' }, { source: YUSUF, fileName: 'yusuf.mp3' })).toBe(false);
  });
});
