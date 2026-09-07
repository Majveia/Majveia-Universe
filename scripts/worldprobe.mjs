import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 400)));
await page.goto('http://localhost:4173/?seed=ORIGIN&n=64&intro=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
await page.evaluate((pl) => window.majveia.travel('world',
  { cluster: 0, member: 0, star: 0, planet: pl }), Number(process.argv[3] ?? 1));
await page.waitForTimeout(12000);
console.log(JSON.stringify(await page.evaluate(() => window.majveia.app.stage.title)));
await page.screenshot({ path: process.argv[2] });
await browser.close();
