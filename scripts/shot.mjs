// Headless screenshot harness: boots the built app, waits for the universe to
// finish generating, optionally sets the epoch, and writes a PNG.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.join('=') || 'true'];
}));

const out = args.out ?? 'shot.png';
const width = +(args.w ?? 1600);
const height = +(args.h ?? 1000);
const url = args.url ?? 'http://localhost:4173/';
const settle = +(args.settle ?? 2500);

const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: EXEC,
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox',
  ],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`PAGEERROR: ${e.message}`));

await page.goto(url + (args.page ?? '') + (args.q ? '?' + args.q : ''), { waitUntil: 'load', timeout: 60000 });
try {
  await page.waitForFunction(() => window.majveia?.ready === true || window.lab?.ready === true, null, { timeout: 180000 });
} catch (e) {
  logs.push('TIMEOUT waiting for ready');
}
if (args.epoch) await page.evaluate((a) => window.majveia.setEpoch(+a), args.epoch);
if (args.eval) await page.evaluate(args.eval);
await page.waitForTimeout(settle);
if (args.hideui) await page.evaluate(() => document.getElementById('ui').classList.add('hidden'));
else await page.evaluate(() => document.getElementById('ui').classList.remove('idle'));
await page.waitForTimeout(300);
await page.screenshot({ path: out });
console.log(logs.slice(-30).join('\n'));
console.log('wrote', out);
await browser.close();
