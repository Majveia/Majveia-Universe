// The cluster core close up: this is where ram-pressure stripping happens and
// where the tails have to look right.
import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 400)));
await page.goto('http://localhost:4173/?seed=ORIGIN&n=64', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
await page.evaluate(() => window.majveia.travel('cluster', { cluster: 0 }));
await page.waitForTimeout(4000);
await page.evaluate(() => {
  const c = window.majveia.controls;
  c.dTarget = c.distance * 0.2;
});
await page.waitForTimeout(+(process.argv[3] ?? 14000));
console.log(JSON.stringify(await page.evaluate(() => {
  const st = window.majveia.app.stage, o = st.orbits;
  let n = 0, max = 0;
  for (let i = 0; i < o.length; i++) { if (o.strip[i] > 0.12) n++; max = Math.max(max, o.strip[i]); }
  return { stripping: n, max: +max.toFixed(2), shown: st.strippingCount, gyr: +(st.simTime / 1000).toFixed(2) };
})));
await page.screenshot({ path: process.argv[2] });
await browser.close();
