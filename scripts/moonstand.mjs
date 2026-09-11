// Standing on a moon, looking up at the planet it goes round.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 500)));
await page.goto('http://localhost:4173/?seed=ORIGIN&n=64&intro=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
await page.evaluate((c) => window.majveia.travel('surface', JSON.parse(c)), process.argv[3]);
await page.waitForFunction(() => !window.majveia.app.travelling, null, { timeout: 90000 });
await page.waitForTimeout(3000);
console.log(JSON.stringify(await page.evaluate(() => ({
  title: window.majveia.app.stage.title,
  sub: window.majveia.app.stage.subtitle,
  rows: window.majveia.app.stage.rows().map((r) => `${r.k}=${r.v}${r.u ?? ''}`),
}))));
// Just look at what arriving there actually looks like.
await page.waitForTimeout(3000);
await page.screenshot({ path: process.argv[2] });
await b.close();
