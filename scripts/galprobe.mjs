import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 400)));
await page.goto('http://localhost:4173/?seed=ORIGIN&n=64&intro=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
const member = Number(process.argv[3] ?? 0);
await page.evaluate((m) => window.majveia.travel('galaxy', { cluster: 0, member: m }), member);
await page.waitForTimeout(11000);
console.log(JSON.stringify(await page.evaluate(() => ({
  rows: window.majveia.app.stage.rows().map((r) => `${r.k}=${r.v}${r.u ?? ''}`),
  title: window.majveia.app.stage.title,
}))));
await page.screenshot({ path: process.argv[2] });
await browser.close();
