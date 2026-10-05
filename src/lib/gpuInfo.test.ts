import { describe, it, expect } from 'vitest';
import { isPlaceholderRenderer, isSoftwareRenderer, realGpuName } from './gpuInfo';

describe('realGpuName', () => {
  it('names a card the browser really reports', () => {
    expect(realGpuName('ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Direct3D11 vs_5_0 ps_5_0)')).toContain('RTX 5080');
    expect(realGpuName('Apple M2')).toBe('Apple M2');
  });

  it('names nothing for the stand-ins browsers give to stop fingerprinting', () => {
    // Firefox on a desktop with an RTX 5080, exporting from the hosted studio.
    expect(realGpuName('NVIDIA GeForce GTX 980, or similar')).toBeNull();
    expect(realGpuName('Brave')).toBeNull();
    expect(isPlaceholderRenderer('Brave')).toBe(true);
  });

  it('names nothing when drawing is done in software on the processor', () => {
    expect(realGpuName('Google SwiftShader')).toBeNull();
    expect(realGpuName('llvmpipe (LLVM 17.0.6, 256 bits)')).toBeNull();
    expect(isSoftwareRenderer('Microsoft Basic Render Driver')).toBe(true);
  });

  it('names nothing when the browser says nothing', () => {
    expect(realGpuName(null)).toBeNull();
  });
});
