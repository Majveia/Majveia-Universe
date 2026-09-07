// Screenshot the touch interface at real phone metrics. `touch=1` forces the
// coarse-pointer branch, so a desktop browser answers the way a phone does.
import { chromium, devices } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.join('=')];
}));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const device = devices[args.device ?? 'iPhone 13'];
const ctx = await browser.newContext({
  ...device, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.log('ERR', m.text().slice(0, 200)); });

const q = new URLSearchParams({ seed: args.seed ?? 'ORIGIN', touch: '1', n: '64' });
if (args.q) for (const [k, v] of new URLSearchParams(args.q)) q.set(k, v);
await page.goto(`http://localhost:4173/?${q}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
await page.waitForTimeout(+(args.settle ?? 7000));
if (args.eval) await page.evaluate(args.eval);
await page.waitForTimeout(+(args.after ?? 1200));
await page.evaluate(() => document.getElementById('ui').classList.remove('idle'));
await page.screenshot({ path: args.out ?? 'phone.png' });
console.log('viewport', JSON.stringify(page.viewportSize()), '->', args.out);
await browser.close();
