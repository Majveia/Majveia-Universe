import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 400)));
await page.goto('http://localhost:4173/?seed=ORIGIN&n=64', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
await page.evaluate(() => window.majveia.travel('galaxy', { cluster: 0, member: 0 }));
await page.waitForTimeout(9000);
await page.evaluate(() => window.majveia.app.runKey('KeyQ'));
await page.waitForTimeout(3000);
console.log(await page.evaluate(() => {
  const st = window.majveia.app.stage;
  const out = {};
  try { out.rows = st.rows().length; } catch (e) { out.rowsErr = String(e).slice(0, 200); }
  try { out.overlay = !!st.overlay(); } catch (e) { out.overlayErr = String(e).slice(0, 300); }
  return out;
}));
await browser.close();
