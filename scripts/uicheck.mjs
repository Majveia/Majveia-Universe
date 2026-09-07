// What the interface actually looks like once the opening run has handed over.
import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 400)));
await page.goto(`http://localhost:4173/?seed=ORIGIN&n=64${process.argv[3] ?? '&intro=0'}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
await page.waitForTimeout(4000);
for (const step of (process.argv[4] ?? '').split(',').filter(Boolean)) {
  await page.evaluate((s) => window.majveia.travel(...JSON.parse(s)), step);
  await page.waitForTimeout(7000);
}
// Show that the hints retire once used.
await page.mouse.move(500, 350); await page.mouse.down();
await page.mouse.move(560, 380); await page.mouse.up();
await page.waitForTimeout(2200);
console.log(await page.evaluate(() =>
  [...document.querySelectorAll('.hint [data-taught]')].map((e) => [e.dataset.taught, e.className])));
await page.screenshot({ path: process.argv[2] });
await browser.close();
