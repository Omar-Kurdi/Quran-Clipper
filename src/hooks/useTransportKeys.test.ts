import { describe, it, expect } from 'vitest';
import { extraShortcut } from './useTransportKeys';

const key = (over: Partial<Parameters<typeof extraShortcut>[0]>) =>
  ({ code: '', key: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });

describe('extraShortcut', () => {
  it('saves on Ctrl+S and on Cmd+S, by physical key', () => {
    expect(extraShortcut(key({ code: 'KeyS', key: 's', ctrlKey: true }))).toBe('save');
    // An Arabic layout sends another letter for the same key.
    expect(extraShortcut(key({ code: 'KeyS', key: 'س', metaKey: true }))).toBe('save');
  });

  it('saves by name where no code is sent', () => {
    expect(extraShortcut(key({ key: 'S', ctrlKey: true }))).toBe('save');
  });

  it('leaves S alone, and Ctrl+Shift+S and Ctrl+Alt+S to the browser', () => {
    expect(extraShortcut(key({ code: 'KeyS', key: 's' }))).toBeNull();
    expect(extraShortcut(key({ code: 'KeyS', key: 'S', ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(extraShortcut(key({ code: 'KeyS', key: 's', ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('steps captions with the bracket keys, whatever the layout types', () => {
    expect(extraShortcut(key({ code: 'BracketLeft', key: 'ج' }))).toBe('prev-caption');
    expect(extraShortcut(key({ code: 'BracketRight', key: ']' }))).toBe('next-caption');
    expect(extraShortcut(key({ key: '[' }))).toBe('prev-caption');
  });

  it('does not step captions on a bracket chord', () => {
    expect(extraShortcut(key({ code: 'BracketLeft', key: '[', ctrlKey: true }))).toBeNull();
    expect(extraShortcut(key({ code: 'BracketRight', key: ']', altKey: true }))).toBeNull();
  });
});
