// Standing on a world: does the sky do what the physics says it should?
import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 600)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 400)); });
await page.goto('http://localhost:4173/?seed=ORIGIN&n=64&intro=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
const ctx = JSON.parse(process.argv[3] ?? '{"cluster":0,"member":0,"star":0,"planet":1,"lat":34}');
await page.evaluate((c) => window.majveia.travel('surface', c), ctx);
await page.waitForTimeout(9000);
console.log(JSON.stringify(await page.evaluate(() => ({
  id: window.majveia.app.stage?.id,
  title: window.majveia.app.stage?.title,
  rows: window.majveia.app.stage.rows().map((r) => `${r.k}=${r.v}${r.u ?? ''}`),
}))));
await page.screenshot({ path: process.argv[2] });
await browser.close();
