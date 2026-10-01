import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PALETTES } from '@/components/PaletteSwitcher';

const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');

describe('palette blocks in globals.css', () => {
  it('gives every palette in the picker a block of its own', () => {
    for (const { id } of PALETTES) expect(css).toContain(`[data-palette="${id}"]`);
  });

  it('writes each palette after the default, so the default cannot override it', () => {
    // `:root` and `[data-palette=…]` weigh the same; whichever comes last wins.
    // Nocturne once sat above the default and picking it changed nothing.
    const fallback = css.indexOf(':root,\n[data-palette=');
    expect(fallback).toBeGreaterThan(-1);
    for (const { id } of PALETTES) {
      const block = css.indexOf(`[data-palette="${id}"] {`);
      if (block === -1) continue; // the default itself, bound together with :root
      expect(block, id).toBeGreaterThan(fallback);
    }
  });
});
