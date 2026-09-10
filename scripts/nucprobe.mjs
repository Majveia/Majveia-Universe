// The ninth rung: the nucleus, and the curve the whole ladder resolves into.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 400)));
await page.goto('http://localhost:4173/?real=1&intro=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });

const settle = () => page.waitForFunction(() => !window.majveia.app.travelling, null, { timeout: 90000 });
const go = async (z) => {
  await page.evaluate((zz) => window.majveia.travel('nucleus',
    { real: true, cluster: 0, member: 0, star: 0, planet: 2, z: zz }), z);
  await settle();
  await page.waitForTimeout(1200);
};

for (const z of [1, 8, 26, 14]) {
  await go(z);
  const r = await page.evaluate(() => {
    const st = window.majveia.app.stage;
    return {
      title: st.title, sub: st.subtitle, fps: window.majveia.app.fps.toFixed(0),
      rows: st.rows().map((x) => `${x.k} = ${x.v}${x.u ?? ''}`),
      overlay: !!st.overlay(),
    };
  });
  console.log(`\n=== Z=${z} → ${r.title} (${r.fps} fps, curve ${r.overlay ? 'up' : 'MISSING'}) ===`);
  console.log(r.sub);
  console.log(r.rows.join('\n'));
}

// Do the nucleons actually orbit, and does the drop keep its shape while they do?
await go(26);
const churn = await page.evaluate(() => {
  const st = window.majveia.app.stage;
  const arr = () => Array.from(st.view.geo.getAttribute('aPos').array);
  const rms = (a) => {
    let s = 0;
    for (let i = 0; i < a.length; i += 3) s += a[i] ** 2 + a[i + 1] ** 2 + a[i + 2] ** 2;
    return Math.sqrt(s / (a.length / 3));
  };
  const a0 = arr(), r0 = rms(a0);
  const samples = [];
  for (let k = 1; k <= 8; k++) {
    st.view.setTime(st.simTime + k * st.timeScale * 0.2);
    samples.push(rms(arr()));
  }
  st.view.setTime(st.simTime + st.timeScale * 0.25);
  const a1 = arr();
  let moved = 0, maxShift = 0;
  for (let i = 0; i < a0.length; i += 3) {
    const d = Math.hypot(a0[i] - a1[i], a0[i + 1] - a1[i + 1], a0[i + 2] - a1[i + 2]);
    if (d > 1e-6) moved++;
    maxShift = Math.max(maxShift, d);
  }
  return {
    nucleons: a0.length / 3,
    rmsRadiusFm: +r0.toFixed(3),
    rmsOverTime: samples.map((x) => +x.toFixed(3)),
    movedOfTotal: `${moved}/${a0.length / 3}`,
    maxShiftFm: +maxShift.toFixed(3),
  };
});
console.log('\nchurn:', JSON.stringify(churn));

await page.waitForTimeout(1600);
await page.screenshot({ path: '/tmp/nucleus-iron.png' });
await go(1);
await page.waitForTimeout(1600);
await page.screenshot({ path: '/tmp/nucleus-hydrogen.png' });
await b.close();
