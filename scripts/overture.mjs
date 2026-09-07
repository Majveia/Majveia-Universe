// The opening run: thirteen point eight billion years, once, at the start.
import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 400)));
await page.goto('http://localhost:4173/?seed=ORIGIN&n=64', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
const probe = () => page.evaluate(() => ({
  z: +window.majveia.app.epochA.toFixed(4),
  d: +window.majveia.controls.distance.toFixed(1),
  epoch: document.querySelector('.tl-epoch')?.textContent
      ?? document.querySelector('.epoch')?.textContent ?? '',
}));
for (let i = 0; i < 26; i++) {
  console.log(i, JSON.stringify(await probe()));
  if (i <= 6 || i === 12 || i === 22) await page.screenshot({ path: `${process.argv[2]}-${i}.png` });
  await page.waitForTimeout(3500);
}
console.log('end', JSON.stringify(await probe()));
await browser.close();
