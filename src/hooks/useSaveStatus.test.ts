import { describe, it, expect } from 'vitest';
import { staysUp } from './useSaveStatus';

describe('staysUp', () => {
  it('keeps a failure on screen, with or without a reason', () => {
    expect(staysUp({ text: 'Save Failed', kind: 'error', detail: 'The server answered 500.' })).toBe(true);
    expect(staysUp({ text: 'Save Failed', kind: 'error' })).toBe(true);
  });

  it('keeps a save that worked but has something to say', () => {
    expect(staysUp({ text: 'Project Saved!', kind: 'ok', detail: 'no room to keep the recitation' })).toBe(true);
  });

  it('lets a plain save, a save in progress and nothing at all go', () => {
    expect(staysUp({ text: 'Project Saved!', kind: 'ok' })).toBe(false);
    expect(staysUp({ text: 'Saving…', kind: 'pending', detail: 'x' })).toBe(false);
    expect(staysUp(null)).toBe(false);
  });
});
