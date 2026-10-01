import { describe, it, expect } from 'vitest';
import { exportRoute } from './exportRoute';

describe('exportRoute', () => {
  it('renders straight away only one destination in the studio’s own shape', () => {
    expect(exportRoute(['9:16'], '9:16', false)).toBe('single');
  });

  it('queues a destination in another shape, so the studio switches to it first', () => {
    expect(exportRoute(['1:1'], '9:16', false)).toBe('queue');
  });

  it('queues several destinations, even all in the studio’s shape', () => {
    expect(exportRoute(['9:16', '9:16'], '9:16', false)).toBe('queue');
  });

  it('sends everything to the server when asked, whatever the shape', () => {
    expect(exportRoute(['9:16', '16:9'], '9:16', true)).toBe('server');
  });
});
