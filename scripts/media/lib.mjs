/**
 * Shared by the media recordings (see docs/MEDIA.md): a browser in the
 * studio's language with the guided tour marked seen, and a drawn pointer,
 * since a headless recording has none.
 *
 * Playwright is not a dependency of the app; install it for the run with
 * `npm i --no-save playwright` and `npx playwright install chromium`.
 * `CHROMIUM` points at another Chromium build where needed.
 */
import { chromium } from 'playwright';

/** The studio to record, e.g. a production build on port 45709 (docs/MEDIA.md). */
export const BASE = process.env.STUDIO_URL;
if (!BASE) throw new Error('Set STUDIO_URL to the running studio.');
export async function open(locale, { video, viewport = { width: 1280, height: 800 } } = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(video ? { recordVideo: { dir: video, size: viewport } } : {}) });
  await ctx.addCookies([{ name: 'qc-lang', value: locale, url: BASE }]);
  await ctx.addInitScript(() => {
    for (const l of ['en', 'ar']) localStorage.setItem('quranclipper.guide.v1.' + l, '1');
    addEventListener('DOMContentLoaded', () => {
      const dot = document.createElement('div');
      dot.style.cssText = 'position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,255,255,.35);border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.6);pointer-events:none;left:-50px;top:-50px;transition:transform .12s';
      document.body.appendChild(dot);
      addEventListener('mousemove', e => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true);
      addEventListener('mousedown', () => { dot.style.transform = 'scale(.7)'; }, true);
      addEventListener('mouseup', () => { dot.style.transform = ''; }, true);
    });
  });
  const page = await ctx.newPage();
  // To stderr: stdout is the line encode.py reads.
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text().slice(0, 160)); });
  return { browser, ctx, page };
}
/** Moves the pointer to an element in view and clicks it, slowly enough to follow. */
export async function click(page, locator, { pause = 350 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await page.waitForTimeout(pause);
  await page.mouse.down(); await page.waitForTimeout(90); await page.mouse.up();
}
