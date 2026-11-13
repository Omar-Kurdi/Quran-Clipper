/**
 * Takes the READMEs' still screenshots (docs/screenshots/QuranClipper_*.png,
 * Arabic under docs/screenshots/ar/) from a running studio, in one language,
 * so they can be taken again whenever the interface changes.
 *
 *     node scripts/media/shots.mjs <en|ar>
 *
 * Against the same production studio as the GIFs, with the sidecar running
 * and DEMO_RECORDING set: the recording is matched for the studio and
 * timeline shots. See docs/MEDIA.md.
 */
import { open, BASE } from './lib.mjs';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const locale = process.argv[2];
if (!['en', 'ar'].includes(locale)) throw new Error('Usage: node scripts/media/shots.mjs <en|ar>');
const L = {
  en: { rec: 'My recording', match: 'Match recording', trim: 'Trim audio', change: 'Change', exp: 'Export' },
  ar: { rec: 'تسجيلي', match: 'طابِق التسجيل', trim: 'قص الصوت', change: 'تغيير', exp: 'تصدير' },
}[locale];
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = `${ROOT}/docs/screenshots/${locale === 'ar' ? 'ar/' : ''}`;
const file = name => `${OUT}QuranClipper_${name}.png`;

const VIEW = { width: 1600, height: 1000 };
/** Tall enough that a whole panel fits without scrolling, for a panel's own shot. */
const TALL = { width: 1600, height: 3400 };

const { browser, ctx, page } = await open(locale, { viewport: VIEW, scale: 2 });
const rail = item => page.locator(`#panel-tab-${item}`);
const dialog = () => page.getByRole('dialog').last();
const settle = (ms = 800) => page.waitForTimeout(ms);

/**
 * A whole panel, its head included, with the window made tall enough to hold
 * it, and cut where its settings end rather than at the foot of the window.
 */
async function panel(selector, name) {
  await page.setViewportSize(TALL);
  await settle(1200);
  const clip = await page.locator(selector).evaluate(el => {
    const box = el.getBoundingClientRect();
    let bottom = box.top;
    for (const child of el.querySelectorAll(':scope > *, :scope > * > *')) bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
    return { x: box.left, y: box.top, width: box.width, height: Math.min(box.height, bottom - box.top + 16) };
  });
  await page.screenshot({ path: name, clip });
  await page.setViewportSize(VIEW);
  await settle(400);
}

await page.goto(BASE + '/video-creator');
await settle(3000);
// The drawn pointer is for the recordings; a still has no use for it.
await page.addStyleTag({ content: '#qc-pointer { display: none !important; }' });

// Source, with a recording chosen and not yet matched.
await rail('source').click();
await page.getByText(L.rec, { exact: true }).first().click();
await page.locator('#recitation-upload').setInputFiles(process.env.DEMO_RECORDING);
await settle(2500);
await panel('#panel-source', file('Matching'));

await page.locator('#panel-source').getByRole('button', { name: new RegExp(L.trim) }).first().click();
await settle(2500);
await dialog().screenshot({ path: file('Trimmer') });
await page.keyboard.press('Escape');
await settle();

await page.getByRole('button', { name: L.match }).click();
await page.getByRole('button', { name: /^113:5/ }).waitFor({ timeout: 180000 });
// The match's own look and background arrive a moment after its captions.
await settle(6000);
// A match picks a stock background of its own; the first preset is the
// studio's own default look, so every still shows the same one.
await rail('presets').click();
await page.locator('#panel-style button[aria-pressed]').first().click();
await settle(4000);

// The studio with the second ayah's caption open, and its timeline.
await rail('captions').click();
await page.getByRole('button', { name: /^113:2/ }).first().click();
await settle(1500);
await page.screenshot({ path: file('Studio') });
await page.locator('[data-tour="timeline"]').screenshot({ path: file('Timeline') });

await page.locator('#panel-captions').getByRole('button', { name: L.change, exact: true }).first().click();
await settle(1500);
await dialog().screenshot({ path: file('Translations') });
await page.keyboard.press('Escape');
await settle();

// The look, one panel at a time.
await rail('presets').click();
await panel('#panel-style', file('Presets'));
await rail('text').click();
await panel('#panel-style', file('Layout'));
await rail('background').click();
await panel('#panel-style', file('BackgroundPicker'));

// Card and Watermark, one above the other, as one picture.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-shots-'));
await rail('card').click();
await panel('#panel-style', `${tmp}/card.png`);
await rail('branding').click();
await panel('#panel-style', `${tmp}/watermark.png`);
const stacked = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', `${tmp}/card.png`, '-i', `${tmp}/watermark.png`,
  '-filter_complex', 'vstack=inputs=2', file('Card_Branding')], { stdio: 'inherit' });
if (stacked.status !== 0) throw new Error('ffmpeg could not stack the Card and Watermark shots');
fs.rmSync(tmp, { recursive: true, force: true });

await page.locator('body').click({ position: { x: 900, y: 20 } });
await page.keyboard.press('Shift+Slash');
await settle(1200);
await dialog().screenshot({ path: file('Shortcuts') });
await page.keyboard.press('Escape');
await settle();

await page.getByRole('button', { name: new RegExp('^' + L.exp) }).first().click();
await settle(1500);
await dialog().screenshot({ path: file('Export') });

await ctx.close();
await browser.close();
console.log(`Screenshots written to ${OUT}`);
