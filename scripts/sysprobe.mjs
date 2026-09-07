import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 400)));
await page.goto('http://localhost:4173/?seed=ORIGIN&n=64&intro=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
await page.evaluate(() => window.majveia.travel('system', { cluster: 0, member: 0, star: 0 }));
await page.waitForTimeout(9000);
console.log(JSON.stringify(await page.evaluate(() => {
  const st = window.majveia.app.stage;
  const v = st.view;
  return {
    nComets: v.comets?.length,
    comets: v.comets?.map((c) => ({ name: c.comet?.name, keys: Object.keys(c) })),
    stars: { primary: v.primaryPos?.toArray?.(), comp: v.companionPos?.toArray?.() },
    mag: v.magnification,
    rows: st.rows().map((r) => `${r.k}=${r.v}`),
  };
}), null, 1));
await browser.close();
