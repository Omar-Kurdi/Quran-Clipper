/**
 * Records one scene of the READMEs' demo GIFs, in one language,
 * against a running production studio in public mode, and prints what
 * `encode.py` needs to cut it.
 *
 *     node scripts/media/scenes.mjs <en|ar> <recordings dir> <passage|captions|style|export>
 *
 * See docs/MEDIA.md.
 */
import { open, click, BASE } from './lib.mjs';
import fs from 'fs';
const [locale, outDir, scene] = process.argv.slice(2);
const L = {
  en: { rec: 'My recording', match: 'Match recording', surah: 'Surah', to: 'To ayah', load: 'Load ayahs & audio', style: 'Style', captions: 'Captions', motion: 'Motion', between: 'Between captions:', words: 'Words:', play: 'Play recitation', exp: 'Export', render: 'Render', kaaba: 'Gold Kaaba', starlight: 'Starlight', feed: 'Instagram Feed' },
  ar: { rec: 'تسجيلي', match: 'طابِق التسجيل', surah: 'السورة', to: 'إلى الآية', load: 'تحميل الآيات والصوت', style: 'التنسيق', captions: 'المقاطع', motion: 'الحركة', between: 'بين المقاطع:', words: 'الكلمات:', play: 'تشغيل التلاوة', exp: 'تصدير', render: 'صدّر', kaaba: 'الكعبة الذهبية', starlight: 'ضوء النجوم', feed: null },
}[locale];

async function loadPassage(page, onCamera) {
  const surah = page.getByLabel(L.surah, { exact: true });
  if (onCamera) { const b = await surah.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 18 }); await page.waitForTimeout(400); }
  await surah.selectOption('67');
  await page.waitForTimeout(onCamera ? 700 : 100);
  const to = page.getByLabel(L.to, { exact: true });
  if (onCamera) await click(page, to); 
  await to.fill('2');
  await page.waitForTimeout(onCamera ? 500 : 100);
  const load = page.getByRole('button', { name: L.load });
  if (onCamera) await click(page, load); else await load.click();
  await page.getByRole('button', { name: /^67:2/ }).waitFor({ timeout: 30000 });
}
async function motionSetting(page, which, value) {
  await page.getByRole('tab', { name: new RegExp(L.style) }).click();
  const head = page.getByRole('button', { name: new RegExp('^' + L.motion) });
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await page.getByLabel(which === 'between' ? L.between : L.words, { exact: true }).selectOption(value);
}

const scenes = {
  // Both ways in: a built-in reciter's passage, then a recording of one's
  // own, matched and timed word by word (DEMO_RECORDING, docs/MEDIA.md).
  async passage(page, mark) {
    await mark('start');
    await loadPassage(page, true);
    await page.waitForTimeout(2000);
    await click(page, page.getByRole('button', { name: /^(Edit source|عدّل المصدر)/ }));
    await page.waitForTimeout(700);
    await click(page, page.getByText(L.rec, { exact: true }).first());
    await page.waitForTimeout(700);
    await page.locator('#recitation-upload').setInputFiles(process.env.DEMO_RECORDING);
    await page.waitForTimeout(1500);
    await click(page, page.getByRole('button', { name: L.match }));
    await page.getByRole('button', { name: /^113:5/ }).waitFor({ timeout: 120000 });
    await page.waitForTimeout(2500);
    await mark('end');
  },
  async captions(page, mark) {
    await loadPassage(page, false);
    await page.getByRole('tab', { name: new RegExp(L.style) }).click();
    await page.getByRole('button', { name: new RegExp(L.kaaba) }).first().click();
    await motionSetting(page, 'words', 'highlight');
    await motionSetting(page, 'between', 'focus');
    await page.getByRole('tab', { name: new RegExp(L.captions) }).click();
    await page.waitForTimeout(800);
    await mark('start');
    await click(page, page.getByRole('button', { name: L.play }));
    await page.waitForTimeout(9000);
    await click(page, page.getByRole('button', { name: /^67:2/ }));
    await page.waitForTimeout(2500);
    await mark('end');
  },
  async style(page, mark) {
    await loadPassage(page, false);
    await page.waitForTimeout(500);
    await mark('start');
    await click(page, page.getByRole('tab', { name: new RegExp(L.style) }));
    await page.waitForTimeout(900);
    await click(page, page.getByRole('button', { name: new RegExp(L.kaaba) }).first());
    await page.waitForTimeout(1600);
    await click(page, page.getByRole('button', { name: new RegExp(L.starlight) }).first());
    await page.waitForTimeout(1600);
    const head = page.getByRole('button', { name: new RegExp('^' + L.motion) });
    await click(page, head);
    await page.waitForTimeout(500);
    const words = page.getByLabel(L.words, { exact: true });
    await click(page, words); await words.selectOption('highlight');
    await page.waitForTimeout(500);
    await click(page, page.getByRole('button', { name: L.play }));
    await page.waitForTimeout(4500);
    await mark('end');
  },
  async export(page, mark) {
    await loadPassage(page, false);
    await page.waitForTimeout(500);
    await mark('start');
    await click(page, page.getByRole('button', { name: new RegExp('^' + L.exp) }).first());
    await page.waitForTimeout(1500);
    const dialog = page.getByRole('dialog');
    if (L.feed) { await click(page, dialog.getByText(L.feed, { exact: true }).first()); await page.waitForTimeout(900); }
    await click(page, dialog.getByRole('button', { name: new RegExp('^' + L.render) }).first());
    await page.waitForTimeout(6000);
    await mark('end');
  },
};

const run = scenes[scene];
if (!run) throw new Error(`No scene "${scene}": ${Object.keys(scenes).join(', ')}`);
const dir = `${outDir}/${locale}-${scene}`;
fs.rmSync(dir, { recursive: true, force: true });
const { browser, ctx, page } = await open(locale, { video: dir });
const t0 = Date.now();
await page.goto(BASE + '/video-creator');
await page.waitForTimeout(3000);
await page.mouse.move(640, 400);
const marks = {};
await run(page, async key => { marks[key] = (Date.now() - t0) / 1000; });
await ctx.close();
await browser.close();
const video = fs.readdirSync(dir).find(name => name.endsWith('.webm'));
// What encode.py takes, in its order.
console.log([`${dir}/${video}`, marks.start, marks.end, locale, scene].join(' '));
