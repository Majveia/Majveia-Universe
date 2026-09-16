// The scale strip at a few rungs, plus a crop of it on its own.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)));
await page.goto('http://localhost:4173/?real=1&intro=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });

const R = { cluster: 0, member: 0, star: 0, real: 1, planet: 2, lat: 34 };
const rungs = [
  ['cosmos', {}],
  ['galaxy', { cluster: 0, member: 0 }],
  ['surface', R],
  ['matter', R],
  ['nucleus', { ...R, z: 26 }],
];
for (const [id, ctx] of rungs) {
  await page.evaluate(([i, c]) => window.majveia.travel(i, c), [id, ctx]);
  await page.waitForFunction(() => !window.majveia.app.travelling, null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.getElementById('ui').classList.remove('idle'));
  const box = await page.evaluate(() => {
    const e = document.querySelector('.strip');
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top),
      w: Math.round(r.width), h: Math.round(r.height) };
  });
  await page.screenshot({ path: `/tmp/strip-${id}.png`,
    clip: { x: box.x - 6, y: box.y - 6, width: box.w + 12, height: box.h + 12 } });
  console.log(id.padEnd(9), JSON.stringify(box));
}
// And one whole frame, so the strip can be seen in its place.
await page.screenshot({ path: '/tmp/strip-frame.png' });
await b.close();
