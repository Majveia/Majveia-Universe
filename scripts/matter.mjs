// The seventh rung: the ground, at the scale where it stops being ground.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 400)));
await page.goto('http://localhost:4173/?real=1&intro=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });

const settle = () => page.waitForFunction(() => !window.majveia.app.travelling, null, { timeout: 90000 });
const go = async (ctx) => {
  await page.evaluate((c) => window.majveia.travel('matter', c), ctx);
  await settle();
  await page.waitForTimeout(1200);
};
const R = { real: true, cluster: 0, member: 0, star: 0 };
const places = [
  ['Earth', { ...R, planet: 2 }],
  ['Mars', { ...R, planet: 3 }],
  ['Mercury', { ...R, planet: 0 }],
  ['Europa', { ...R, planet: 4, moon: 1 }],
  ['Triton', { ...R, planet: 7, moon: 0 }],
];
for (const [name, ctx] of places) {
  await go(ctx);
  const r = await page.evaluate(() => {
    const st = window.majveia.app.stage;
    return {
      title: st.title, sub: st.subtitle, fps: window.majveia.app.fps.toFixed(0),
      rows: st.rows().map((x) => `${x.k} = ${x.v}${x.u ?? ''}`),
    };
  });
  console.log(`\n=== ${name} → ${r.title} (${r.fps} fps) ===`);
  console.log(r.sub);
  console.log(r.rows.join('\n'));
}

// The descent itself: does the surface hand you the ground under it?
await page.evaluate(() => window.majveia.travel('surface',
  { real: true, cluster: 0, member: 0, star: 0, planet: 2, lat: 34 }));
await settle();
const step = await page.evaluate(() => {
  const c = window.majveia.app.stage.child();
  return c ? { id: c.id, label: c.label } : null;
});
console.log('\nsurface.child() →', JSON.stringify(step));

// Are the phonons actually moving anything?
await go({ ...R, planet: 2 });
const motion = await page.evaluate(async () => {
  const st = window.majveia.app.stage;
  const snap = () => {
    const a = st.view.atomGeo.getAttribute('aPos').array;
    return Array.from(a.slice(0, 60));
  };
  const t0 = st.simTime;
  const a0 = snap();
  st.simTime = t0 + st.timeScale * 0.5;
  st.view.setTime(st.simTime);
  const a1 = snap();
  let max = 0, sum = 0;
  for (let i = 0; i < a0.length; i++) {
    const d = Math.abs(a0[i] - a1[i]);
    max = Math.max(max, d); sum += d;
  }
  return { maxShiftAng: max, meanShiftAng: sum / a0.length,
    atoms: st.atoms.length, timeScale: st.timeScale };
});
console.log('\nphonons:', JSON.stringify(motion));

// Pick an atom and read where it came from.
const insp = await page.evaluate(() => {
  const st = window.majveia.app.stage;
  for (let x = -0.3; x <= 0.3; x += 0.05) {
    for (let y = -0.3; y <= 0.3; y += 0.05) {
      const r = st.inspect({ x, y });
      if (r) return { title: r.title, kind: r.kind, rows: r.rows.map((q) => `${q.k}=${q.v}${q.u ?? ''}`), note: r.note };
    }
  }
  return null;
});
console.log('\ninspect:', JSON.stringify(insp, null, 1));

await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/matter-quartz.png' });
await page.evaluate(() => { window.majveia.app.stage.swell(); });
await page.waitForTimeout(2200);
await page.screenshot({ path: '/tmp/matter-full.png' });
await b.close();
