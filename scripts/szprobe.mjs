// The cluster in the microwave: a cold spot, a null, then a hot spot.
import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 500)));
await page.goto('http://localhost:4173/?seed=ORIGIN&n=64&intro=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
await page.evaluate(() => window.majveia.travel('cluster', { cluster: 0 }));
await page.waitForTimeout(7000);
for (let i = 0; i < 5; i++) {
  await page.evaluate(() => window.majveia.app.runKey('Semicolon'));
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => ({
    ghz: window.majveia.app.stage.microwaveGHz,
    rows: window.majveia.app.stage.rows().map((r) => `${r.k}=${r.v}${r.u ? ' ' + r.u : ''}`),
  }));
  console.log(i, info.ghz, JSON.stringify(info.rows.slice(0, 7)));
  if (info.ghz) await page.screenshot({ path: `${process.argv[2]}-${info.ghz}.png` });
}
await browser.close();
