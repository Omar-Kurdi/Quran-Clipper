import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Unit tests for the pure logic in `src/lib`.
 *
 * Deliberately scoped to functions rather than components. The timeline rules,
 * the background schedule and the export naming are where the bugs have
 * actually been -- a badge that read `At-Tahrim 1-12 (66:6-8)`, an image
 * background that silently never drew, a clip filed under the ayah range it
 * was trimmed *from* -- and every one of them is a plain function with plain
 * inputs. Rendering tests would cost far more and catch far less.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
