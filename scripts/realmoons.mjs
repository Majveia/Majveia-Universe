import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 700, height: 450 } });
await page.goto('http://localhost:4173/?seed=ORIGIN&n=64&intro=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
await page.evaluate(() => window.majveia.travel('system', { cluster: 0, member: 0, star: 0, real: 1 }));
await page.waitForFunction(() => !window.majveia.app.travelling, null, { timeout: 90000 });
console.log(JSON.stringify(await page.evaluate(() => window.majveia.app.stage.system.planets.map((p, i) =>
  `${i}:${p.name} ${p.pressureBar.toFixed(0)}bar rings=${p.rings.length} moons=[${p.moons.map((m, j) => `${j}:${m.name}:${(m.radiusM/1e3).toFixed(0)}km`).join(' ')}]`)), null, 1));
await b.close();
