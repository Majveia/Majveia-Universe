// Watch the Solar System die, in the real app, with nothing poked but the age:
// jump to the tip of the giant branch and let the sequence run on its own clock.
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')];
}));
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const W = +(args.w ?? 620), H = +(args.h ?? 420);
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('console', (m) => { const x = m.text(); if (x.includes('[pn]')) console.log(x.slice(0, 200)); });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)));
await page.goto('http://localhost:4173/?seed=' + (args.seed ?? 'ORIGIN'), { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
await page.evaluate((m) => window.majveia.travel('system',
  m === 'real' ? { cluster: 0, member: 0, star: 0, real: 1 } : { cluster: 0, member: 0, star: +m }),
  args.sys ?? 'real');
await page.waitForTimeout(9000);
await page.keyboard.press('y');
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const st = window.majveia.app.stage;
  st.evoAge = st.system.star.lifetimeGyr * 1.1199;
});
const every = +(args.every ?? 5000);
const n = +(args.n ?? 12);
for (let i = 0; i < n; i++) {
  await page.waitForTimeout(every);
  await page.evaluate(() => document.getElementById('ui').classList.remove('idle'));
  await page.screenshot({ path: `${args.out ?? 'pn'}-${String(i).padStart(2, '0')}.png` });
  const r = await page.evaluate(() => {
    const st = window.majveia.app.stage;
    return { t: st.evoNebulaT, yr: st.evoNebulaYr, au: st.evoShellAu,
      d: window.majveia.controls.distance, on: !!st.evoNebula };
  });
  console.log(`#${i} clock=${r.t?.toFixed(1)}s yr=${r.yr?.toFixed(0)} shell=${r.au?.toFixed(0)}AU cam=${r.d?.toFixed(0)}AU on=${r.on}`);
}
await browser.close();
