// Every scale, as it actually looks, with motion measured rather than assumed.
import { chromium } from 'playwright';
const out = process.argv[2] ?? '/tmp/s';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 400)));
await page.goto('http://localhost:4173/?seed=ORIGIN&n=64&intro=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
await page.waitForTimeout(3000);

const stages = [
  ['cosmos', {}], ['cluster', { cluster: 0 }], ['galaxy', { cluster: 0, member: 0 }],
  ['system', { cluster: 0, member: 0, star: 0 }],
  ['world', { cluster: 0, member: 0, star: 0, planet: 1 }],
];
for (const [id, ctx] of stages) {
  await page.evaluate(([i, c]) => window.majveia.travel(i, c), [id, ctx]);
  await page.waitForTimeout(8000);
  // Does anything actually move? Compare two frames a second apart.
  const a = await page.screenshot();
  await page.waitForTimeout(2500);
  const b = await page.screenshot();
  let diff = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) diff++;
  const info = await page.evaluate(() => ({
    id: window.majveia.app.stage?.id, t: +(window.majveia.app.stage?.simTime ?? 0).toPrecision(4),
    fps: document.querySelector('.readout')?.textContent?.match(/(\d+)fps/)?.[1],
  }));
  console.log(id, JSON.stringify(info), 'bytesDiffer=' + diff);
  await page.screenshot({ path: `${out}-${id}.png` });
}
await browser.close();
