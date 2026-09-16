// Every rung's two clocks, and the axis that holds them.
//
// Walks the whole ladder with the axis switched into seconds and prints what
// each rung says about itself. The last column is the point: it is log10(c/v),
// it peaks on the surface of a planet, and it closes at both ends of the ladder.
//
//   node scripts/clocks.mjs            the table
//   node scripts/clocks.mjs --shots    and a magnified crop of the strip at each
//
// The crops are off by default because they need a three-times framebuffer,
// and on a software rasteriser that is four minutes a rung.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const shots = process.argv.includes('--shots');
const page = await b.newPage({ viewport: { width: 1280, height: 800 },
  deviceScaleFactor: shots ? 3 : 1 });
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 400)));
// Pinned. Without a seed every run is a different universe, and the cluster
// and galaxy rows change from one run to the next while the six rungs below
// them - which are the real Solar System - do not.
await page.goto('http://localhost:4173/?seed=ORIGIN&real=1&intro=0&n=64',
  { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 300000 });
await page.waitForTimeout(2500);
await page.evaluate(() => window.majveia.app.runKey('Quote'));
await page.waitForTimeout(900);

const R = { cluster: 0, member: 0, star: 0, real: 1, planet: 2, lat: 34 };
const rungs = [
  ['cosmos', {}], ['cluster', { cluster: 0 }], ['galaxy', { cluster: 0, member: 0 }],
  ['system', R], ['world', R], ['surface', R], ['matter', R],
  ['atom', { ...R, z: 14 }], ['nucleus', { ...R, z: 26 }],
];
console.log('rung      light across it   its own clock     what moves          decades apart');
for (const [id, ctx] of rungs) {
  await page.evaluate(([i, c]) => window.majveia.travel(i, c), [id, ctx]);
  await page.waitForFunction(() => !window.majveia.app.travelling, null, { timeout: 150000 });
  await page.waitForTimeout(shots ? 1700 : 1100);
  await page.evaluate(() => document.getElementById('ui').classList.remove('idle'));
  const r = await page.evaluate(() => {
    const rows = Object.fromEntries([...document.querySelectorAll('.readout .row')].map((x) =>
      [x.querySelector('.k')?.textContent, x.querySelector('.v')?.textContent]));
    const keys = Object.keys(rows);
    const i = keys.indexOf('light across it');
    const e = document.querySelector('.strip').getBoundingClientRect();
    return { light: rows['light across it'], own: i >= 0 ? rows[keys[i + 1]] : '',
      what: i >= 0 ? keys[i + 1] : '', gap: rows['slower by'] ?? '',
      box: { x: Math.round(e.left), y: Math.round(e.top),
        w: Math.round(e.width), h: Math.round(e.height) } };
  });
  console.log(`${id.padEnd(9)} ${String(r.light).padEnd(17)} ${String(r.own).padEnd(17)} `
    + `${String(r.what).padEnd(19)} ${r.gap}`);
  // Two halves, because the whole ruler at three times scale is 3840 px wide.
  if (shots) {
    for (const [half, x] of [['a', r.box.x], ['b', r.box.x + r.box.w / 2]]) {
      await page.screenshot({ path: `/tmp/clock-${id}-${half}.png`,
        clip: { x, y: r.box.y - 3, width: r.box.w / 2, height: r.box.h + 6 } });
    }
  }
}
await b.close();
