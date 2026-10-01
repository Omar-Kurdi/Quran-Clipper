import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTES } from '@/components/PaletteSwitcher';

const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');

/** Every remapped Tailwind colour stop named in the studio's source, such as `amber-300`. */
function usedStops(dir: string, found = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) usedStops(path, found);
    else if (/\.tsx?$/.test(entry.name)) {
      for (const m of readFileSync(path, 'utf8').matchAll(/\b(?:text|bg|border|ring|from|to|via|fill|stroke|outline|accent|decoration|divide|placeholder|caret|shadow)-((?:slate|amber|emerald|blue|red)-\d+)\b/g)) found.add(m[1]);
    }
  }
  return found;
}

describe('palette blocks in globals.css', () => {
  it('gives every palette in the picker a block of its own', () => {
    for (const { id } of PALETTES) expect(css).toContain(`[data-palette="${id}"]`);
  });

  it('sets every colour in every palette, so none falls through to the default', () => {
    const names = ['bg', 'surface', 'edge', 'muted', 'text', 'accent', 'accent-bright', 'live', 'live-bright', 'success', 'error'];
    for (const { id } of PALETTES) {
      const start = css.indexOf(`[data-palette="${id}"]`);
      const block = css.slice(start, css.indexOf('}', start));
      for (const name of names) expect(block, `${id} --p-${name}`).toMatch(new RegExp(`--p-${name}:`));
    }
  });

  it('turns the mixes towards ink on a light palette, not towards white', () => {
    const block = css.slice(css.indexOf('[data-palette="parchment"]'));
    expect(block.slice(0, block.indexOf('}'))).toMatch(/--p-lift: #[0-9a-f]{6};[\s\S]*color-scheme: light;/);
    // Every lighter step of the ramp mixes towards the lift, never a literal white.
    expect(css).not.toMatch(/color-mix\([^)]*,\s*white\)/);
  });

  it('maps every colour stop the studio uses onto the palette', () => {
    // A stop missing from the ramp falls back to Tailwind's own fixed colour:
    // text-amber-100 was a pale yellow on every scheme, unreadable on paper.
    const used = usedStops(fileURLToPath(new URL('..', import.meta.url)));
    expect(used.size).toBeGreaterThan(10);
    for (const stop of used) expect(css, stop).toContain(`--color-${stop}:`);
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
