// Descending into a gas giant: it has no bottom, so it hands you a moon.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 400)));
await page.goto('http://localhost:4173/?seed=ORIGIN&n=64&intro=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
let fails = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); if (!ok) fails++; };
for (const [name, ctx] of [['Jupiter', { planet: 4 }], ['Saturn', { planet: 5 }], ['Neptune', { planet: 7 }]]) {
  await page.evaluate((c) => window.majveia.travel('world',
    { cluster: 0, member: 0, star: 0, real: 1, ...JSON.parse(c) }), JSON.stringify(ctx));
  await page.waitForFunction(() => !window.majveia.app.travelling, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  const t = await page.evaluate(() => {
    const st = window.majveia.app.stage;
    return { title: st.title, bar: st.planet.pressureBar, child: st.child() };
  });
  check(`${name} has no surface but offers a moon`,
    t.bar > 30 && !!t.child && t.child.id === 'surface',
    `${t.bar.toFixed(0)} bar -> ${t.child ? t.child.label : 'nothing'}`);
  if (!t.child) continue;
  await page.evaluate((c) => window.majveia.travel('surface', JSON.parse(c)), JSON.stringify(t.child.ctx));
  await page.waitForFunction(() => !window.majveia.app.travelling, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  const s = await page.evaluate(() => {
    const st = window.majveia.app.stage;
    const g = st.view.moons?.geometry;
    const rows = Object.fromEntries(st.rows().map((r) => [r.k, r.v]));
    return { id: st.id, title: st.title, bodies: g ? g.instanceCount : 0, rows };
  });
  check(`standing on ${s.title}, with ${name} in the sky`,
    s.id === 'surface' && s.bodies > 0 && !!s.rows[name],
    `${s.bodies} bodies · ${name} ${s.rows[name] ?? '—'} · ${s.rows['and it is'] ?? ''}`);
}
console.log(fails === 0 ? '\nthe ladder no longer dead-ends' : `\n${fails} failed`);
await b.close();
process.exit(fails === 0 ? 0 : 1);
