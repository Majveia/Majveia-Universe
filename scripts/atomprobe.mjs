// The eighth rung: one atom, and the fact that it is almost entirely nothing.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 400)));
await page.goto('http://localhost:4173/?real=1&intro=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });

const settle = () => page.waitForFunction(() => !window.majveia.app.travelling, null, { timeout: 90000 });
const go = async (z) => {
  await page.evaluate((zz) => window.majveia.travel('atom',
    { real: true, cluster: 0, member: 0, star: 0, planet: 2, z: zz }), z);
  await settle();
  await page.waitForTimeout(1200);
};

for (const z of [1, 8, 14, 26]) {
  await go(z);
  const r = await page.evaluate(() => {
    const st = window.majveia.app.stage;
    return {
      title: st.title, sub: st.subtitle, fps: window.majveia.app.fps.toFixed(0),
      orbitals: st.specs.length,
      rows: st.rows().map((x) => `${x.k} = ${x.v}${x.u ?? ''}`),
    };
  });
  console.log(`\n=== Z=${z} → ${r.title} (${r.fps} fps, ${r.orbitals} orbitals) ===`);
  console.log(r.sub);
  console.log(r.rows.join('\n'));
}

// Does the cloud actually resample?
const live = await page.evaluate(async () => {
  const st = window.majveia.app.stage;
  const arr = st.cloud.geo.getAttribute('position').array;
  const a0 = Array.from(arr);
  st.cloud.update(0.6);
  const a1 = Array.from(st.cloud.geo.getAttribute('position').array);
  let moved = 0;
  for (let i = 0; i < a0.length; i += 3) {
    if (a0[i] !== a1[i] || a0[i + 1] !== a1[i + 1] || a0[i + 2] !== a1[i + 2]) moved++;
  }
  const n = a0.length / 3;
  return { points: n, resampledInHalfASecond: moved, fraction: +(moved / n).toFixed(3) };
});
console.log('\nresampling:', JSON.stringify(live));

// Is the sampled cloud actually the distribution it claims to be?
const stat = await page.evaluate(() => {
  const st = window.majveia.app.stage;
  const arr = st.cloud.geo.getAttribute('position').array;
  const n = arr.length / 3;
  let mean = 0, max = 0;
  const shells = [];
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
    mean += r / n; max = Math.max(max, r);
    shells.push(r);
  }
  shells.sort((a, b) => a - b);
  return {
    meanRadiusPm: mean, maxPm: max,
    medianPm: shells[n >> 1],
    p99Pm: shells[Math.floor(n * 0.99)],
    drawnAtomRadiusPm: st.radiusM * 1e12,
    nucleusPm: (1.25e-15 * Math.cbrt(st.massNumber)) * 1e12,
  };
});
console.log('cloud:', JSON.stringify(stat));

// One orbital at a time.
const cycle = await page.evaluate(() => {
  const st = window.majveia.app.stage, out = [];
  for (let k = 0; k < 6; k++) out.push(st.cycleOrbital());
  st.cycleOrbital();
  return out;
});
console.log('cycle:', cycle.join(' → '));

// Pictures: the whole cloud, and one 3d orbital on its own.
await go(26);
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/atom-iron.png' });
await go(6);
await page.evaluate(() => {
  const st = window.majveia.app.stage;
  // Walk to the first 2p orbital and stop there.
  for (let k = 0; k < 40; k++) {
    const l = st.cycleOrbital();
    if (l.startsWith('2p')) break;
  }
  window.majveia.app.rebuildReadout();
});
await page.waitForTimeout(2200);
await page.screenshot({ path: '/tmp/atom-2p.png' });
await b.close();
