import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 580 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 300)));
await page.goto('file:///tmp/majveia-check/index.html?seed=SINGLE&n=64', { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 120000 });
  console.log('booted OK');
} catch { console.log('TIMEOUT: never became ready'); }
// Wait for the opening run to hand over rather than for a fixed count. It
// takes most of a minute on a software rasteriser, and a shot taken partway
// through is a picture of the last scattering surface dissolving rather than of
// the thing this file is meant to show working - which is how the screenshot
// in the repository ended up being of cosmic dawn.
try {
  await page.waitForFunction(() => window.majveia.app.overtureT < 0, null, { timeout: 240000 });
  console.log('opening run handed over');
} catch { console.log('WARNING: the opening run never finished'); }
await page.waitForTimeout(2500);
await page.screenshot({ path: process.argv[2] ?? 'single.png' });
console.log(errs.length ? 'errors:\n' + errs.join('\n') : 'no errors');
await browser.close();
