import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 500)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto('http://localhost:4173/?seed=ORIGIN&n=64', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
await page.evaluate(() => window.majveia.travel('cluster', { cluster: 0 }));
await page.waitForTimeout(6000);

const snap = () => page.evaluate(() => {
  const st = window.majveia.app.stage;
  const o = st.orbits;
  const rs = [];
  for (let i = 0; i < Math.min(o.length, 5); i++) rs.push(+o.radius(i).toFixed(4));
  return {
    t: +st.simTime.toFixed(1), n: o.length,
    sigma: Math.round(o.dispersionKms()),
    r50: +o.quantileRadius(0.5).toFixed(3),
    stripping: st.strippingCount,
    gas0: +o.gas[1].toFixed(3),
    first: rs,
  };
});
console.log('t0', JSON.stringify(await snap()));
await page.waitForTimeout(8000);
console.log('t1', JSON.stringify(await snap()));
await page.waitForTimeout(12000);
console.log('t2', JSON.stringify(await snap()));
console.log('rows', JSON.stringify(await page.evaluate(() => window.majveia.app.stage.rows())));
await page.screenshot({ path: process.argv[2] || '/tmp/cluster.png' });
await browser.close();
