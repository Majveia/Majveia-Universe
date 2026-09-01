// Contact sheet: render the same view at several parameter values so a look can
// be judged by comparison instead of by memory.
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')];
}));
const values = (args.values ?? '1').split(',').map(Number);
const call = args.call ?? 'setBrightness';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: +(args.w ?? 760), height: +(args.h ?? 480) }, deviceScaleFactor: 1,
});
page.on('console', (m) => { if (m.type() === 'error') console.log('ERR', m.text()); });
await page.goto('http://localhost:4173/' + (args.page ?? '') + '?' + (args.q ?? ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true || window.lab?.ready === true, null, { timeout: 240000 });
await page.evaluate(() => document.getElementById('ui').classList.add('hidden'));
if (args.epoch) await page.evaluate((a) => window.majveia.setEpoch(+a), args.epoch);
if (args.eval) await page.evaluate(args.eval);
for (const v of values) {
  await page.evaluate(([c, val]) => (window.majveia ?? window.lab)[c](val), [call, v]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${args.out ?? 'sweep'}-${v}.png` });
  console.log('shot', v);
}
await browser.close();
