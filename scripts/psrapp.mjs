import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')];
}));
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) console.log('ERR', m.text().slice(0,200)); });
await page.goto('http://localhost:4173/?seed=ORIGIN&n=64', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
await page.evaluate(() => window.majveia.travel('galaxy', { cluster: 0, member: 0 }));
await page.waitForTimeout(9000);
const n = +(args.n ?? 1);
for (let i = 0; i < n; i++) {
  await page.evaluate(() => window.majveia.app.runKey('KeyQ'));
  await page.waitForTimeout(+(args.settle ?? 5000));
  await page.evaluate(() => document.getElementById('ui').classList.remove('idle'));
  await page.screenshot({ path: `${args.out ?? 'psr'}-${i}.png` });
  console.log(`shot ${i}`);
}
await browser.close();
