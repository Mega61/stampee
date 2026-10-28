// Visual QA for the animated public card (docs/CARD_ENGAGEMENT_PLAN.md §5.0).
// Screenshots /dev/cards at phone size. Needs the dev server running.
//
//   node scripts/card-visual-qa.mjs                      all presets × styles + photo cases
//   node scripts/card-visual-qa.mjs --url "/dev/cards?t=pizza-party&style=playful" --wait 2500
//   BASE_URL=http://localhost:5179 OUT_DIR=/tmp/qa node scripts/card-visual-qa.mjs
//
// Uses Playwright's Chromium, or CHROMIUM_PATH (e.g. /usr/bin/chromium).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT_DIR = process.env.OUT_DIR ?? 'scratch/qa';
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const PRESETS = ['cookie-classic', 'midnight-brew', 'pizza-party', 'sweet-scoops', 'massage-bliss', 'laundry-fresh', 'sharp-cuts', 'boba-time', 'burger-joint'];
const STYLES = ['elegant', 'playful', 'minimal'];

const cases = arg('--url')
  ? [{ name: arg('--name') ?? 'custom', path: arg('--url') }]
  : [
      ...PRESETS.flatMap((t) => STYLES.map((style) => ({ name: `${t}-${style}`, path: `/dev/cards?t=${t}&style=${style}&stamps=4&panel=0` }))),
      { name: 'photo-dark-40', path: '/dev/cards?t=midnight-brew&style=elegant&stamps=4&bg=/image_1.jpg&opacity=40&panel=0' },
      { name: 'photo-light-40', path: '/dev/cards?t=massage-bliss&style=elegant&stamps=4&bg=/image_3.jpg&opacity=40&panel=0' },
      { name: 'photo-busy-20', path: '/dev/cards?t=boba-time&style=playful&stamps=4&bg=/image_4.jpg&opacity=20&panel=0' },
    ];

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

for (const c of cases) {
  await page.goto(BASE_URL + c.path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(Number(arg('--wait') ?? 1800));
  const file = join(OUT_DIR, `${c.name}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}
await browser.close();
if (errors.length) {
  console.error('\nConsole errors:\n' + [...new Set(errors)].join('\n'));
  process.exitCode = 1;
}
