import { describe, it, expect } from 'vitest';
import { sidecarStatus } from './sidecarHealth';

describe('sidecarStatus', () => {
  it('asks for a restart, not files, when the helper predates QUL support', () => {
    const old = sidecarStatus(true, { alignReady: true, canAutoDetectRange: true });
    expect(old.qulSupported).toBe(false);
    expect(old.qulAssist).toBe(false);
  });

  it('tells missing QUL files from a helper that has them', () => {
    expect(sidecarStatus(true, { qulAssist: false })).toMatchObject({ qulSupported: true, qulAssist: false });
    expect(sidecarStatus(true, { qulAssist: true })).toMatchObject({ qulSupported: true, qulAssist: true });
  });

  it('reports nothing usable from a helper that could not be reached', () => {
    expect(sidecarStatus(false, null)).toMatchObject({
      asrAvailable: false, canAutoDetectRange: false, qulAssist: false, qulSupported: false,
    });
  });

  it('treats an absent alignReady as healthy, and false as not', () => {
    expect(sidecarStatus(true, {}).alignReady).toBe(true);
    expect(sidecarStatus(true, { alignReady: false, alignError: 'no nemo' })).toMatchObject({ alignReady: false, alignError: 'no nemo' });
  });
});
