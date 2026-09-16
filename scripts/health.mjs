// Vital signs for the whole ladder: does every rung build, move, cost what it
// should to read, and leave the interface legible at the window sizes people
// actually have?
import { chromium } from 'playwright';

const CTX = {
  cosmos: {},
  cluster: { cluster: 0 },
  galaxy: { cluster: 0, member: 0 },
  system: { cluster: 0, member: 0, star: 0, real: 1 },
  world: { cluster: 0, member: 0, star: 0, real: 1, planet: 2 },
  surface: { cluster: 0, member: 0, star: 0, real: 1, planet: 2, lat: 34 },
  matter: { cluster: 0, member: 0, star: 0, real: 1, planet: 2, lat: 34 },
  atom: { cluster: 0, member: 0, star: 0, real: 1, planet: 2, lat: 34, z: 14 },
  nucleus: { cluster: 0, member: 0, star: 0, real: 1, planet: 2, lat: 34, z: 14 },
};

const SIZES = [[1440, 900], [1100, 700], [1280, 620]];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(46)} ${detail}`);
};

const page = await b.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => { fails++; console.log('PAGEERROR', e.message.slice(0, 300)); });
await page.goto('http://localhost:4173/?real=1&intro=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });

console.log('--- every rung: builds, moves, and is cheap to read ---');
for (const [id, ctx] of Object.entries(CTX)) {
  await page.evaluate(([i, c]) => window.majveia.travel(i, c), [id, ctx]);
  await page.waitForFunction(() => !window.majveia.app.travelling, null, { timeout: 90000 });
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => {
    const app = window.majveia.app, st = app.stage;
    // What one readout tick costs, measured on the real stage.
    st.rows();
    const t0 = performance.now();
    for (let k = 0; k < 40; k++) st.rows();
    const rowsMs = (performance.now() - t0) / 40;
    return {
      id: st.id, rows: st.rows().length, rowsMs: +rowsMs.toFixed(3),
      fps: +app.fps.toFixed(0), label: st.scaleLabel(),
      blank: st.rows().filter((x) => x.v === undefined || x.v === '').length,
    };
  });
  check(`${id} builds and reads`, r.id === id && r.rows > 0 && r.blank === 0,
    `${r.rows} rows · ${r.rowsMs} ms/tick · ${r.fps} fps · scale ${r.label}`);
  // A readout tick is allowed a fifth of a millisecond. Anything more is work
  // being redone that cannot have changed.
  check(`${id} readout tick under 0.2 ms`, r.rowsMs < 0.2, `${r.rowsMs} ms`);
}

// --- The switches whose effect is a number rather than a picture.
//
// Both of these are one line of wiring away from being silently decorative,
// and both were. Pressing C used to swap the label in the masthead and leave
// the running scene integrating the cosmology it was built with, so the age of
// the universe in the readout went on answering for Planck while the screen
// said Einstein-de Sitter. There is nothing to see in a screenshot either way,
// which is exactly why it needs a probe.
console.log('\n--- switches that change numbers rather than pictures ---');
await page.evaluate(() => window.majveia.travel('cosmos', {}));
await page.waitForFunction(() => !window.majveia.app.travelling, null, { timeout: 90000 });
await page.waitForTimeout(1200);
const ages = async () => page.evaluate(() => {
  const r = window.majveia.app.stage.rows();
  const find = (k) => r.find((x) => x.k === k)?.v;
  return { age: parseFloat(find('cosmic time')), z: find('redshift'),
    cone: !!window.majveia.app.stage.onLightCone,
    reading: window.majveia.app.strip?.reading };
});
const planck = await ages();
await page.evaluate(() => window.majveia.app.runKey('KeyC'));
await page.waitForTimeout(1500);
const eds = await ages();
// Einstein-de Sitter is t = (2/3)/H0, which is 9.6 Gyr against Planck's 13.8.
check('C reaches the running scene', Math.abs(planck.age - eds.age) > 2,
  `${planck.age.toFixed(2)} Gyr -> ${eds.age.toFixed(2)} Gyr`);
check('and lands on the right number', eds.age > 9 && eds.age < 10.4,
  `Einstein-de Sitter should be about 9.6 Gyr`);
// Round the rest of the way back to Planck: there are five of them.
for (let i = 0; i < 4; i++) await page.evaluate(() => window.majveia.app.runKey('KeyC'));
await page.waitForTimeout(1200);
check('and comes back round to where it started',
  Math.abs((await ages()).age - planck.age) < 0.2, `${(await ages()).age.toFixed(2)} Gyr`);

// And the axis in seconds, which at this rung also puts the web on its cone.
await page.evaluate(() => window.majveia.app.runKey('Quote'));
await page.waitForTimeout(1200);
const on = await page.evaluate(() => {
  const r = window.majveia.app.stage.rows();
  return { cone: !!window.majveia.app.stage.onLightCone,
    reading: window.majveia.app.strip.reading,
    observing: r.find((x) => x.k === 'observing')?.v,
    horizon: r.find((x) => x.k === 'your horizon')?.v };
});
check("' turns the axis into seconds", on.reading === 'time', on.reading);
check('and the web onto its light cone', on.cone && !!on.observing,
  `${on.observing ?? 'no row'} · horizon ${on.horizon ?? '?'}`);
await page.evaluate(() => window.majveia.app.runKey('Quote'));
await page.waitForTimeout(900);
const off = await page.evaluate(() => ({
  cone: !!window.majveia.app.stage.onLightCone,
  reading: window.majveia.app.strip.reading }));
check('and both go back together', !off.cone && off.reading === 'length',
  `${off.reading} · cone ${off.cone}`);

console.log('\n--- the interface, at the window sizes people have ---');
for (const [w, h] of SIZES) {
  await page.setViewportSize({ width: w, height: h });
  await page.evaluate(() => window.majveia.travel('nucleus',
    { cluster: 0, member: 0, star: 0, real: 1, planet: 2, lat: 34, z: 26 }));
  await page.waitForFunction(() => !window.majveia.app.travelling, null, { timeout: 90000 });
  await page.waitForTimeout(900);
  const box = await page.evaluate(() => {
    const rect = (sel) => {
      const e = document.querySelector(sel);
      return e && getComputedStyle(e).display !== 'none'
        ? e.getBoundingClientRect() : null;
    };
    const pack = (x) => (x ? { top: Math.round(x.top), bottom: Math.round(x.bottom),
      left: Math.round(x.left), right: Math.round(x.right) } : null);
    return {
      ladder: pack(rect('.ladder')), readout: pack(rect('.readout')),
      masthead: pack(rect('.masthead')), strip: pack(rect('.strip')),
      warp: pack(rect('.warp')), hint: pack(rect('.hint')),
      h: innerHeight, w: innerWidth,
    };
  });
  const { ladder, readout, masthead, strip, warp, hint } = box;
  const overlaps = (a, c) => !!a && !!c
    && a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
  check(`${w}×${h}  ladder clear of the readout`, !overlaps(ladder, readout),
    ladder ? `ladder ${ladder.top}-${ladder.bottom}, readout from ${readout.top}` : 'ladder hidden');
  check(`${w}×${h}  ladder clear of the masthead`, !overlaps(ladder, masthead),
    ladder ? `masthead to ${masthead.bottom}` : 'ladder hidden');
  check(`${w}×${h}  readout inside the window`, readout.top >= 0 && readout.bottom <= box.h,
    `${readout.top}-${readout.bottom} of ${box.h}`);
  // The scale strip is the floor the rest of the interface stands on, so
  // nothing may be standing in it. This is the check that was missing when it
  // first went in at the bottom centre and ran straight through the readout's
  // second column.
  check(`${w}×${h}  strip spans the window`,
    !!strip && strip.left <= 0 && strip.right >= box.w,
    strip ? `${strip.left}-${strip.right} of ${box.w}` : 'missing');
  for (const [name, other] of [['readout', readout], ['time', warp], ['hint', hint]]) {
    check(`${w}×${h}  strip clear of the ${name}`, !overlaps(strip, other),
      other ? `${name} to ${other.bottom}, strip from ${strip.top}` : `${name} hidden`);
  }
}

console.log(fails === 0 ? '\nthe ladder is healthy' : `\n${fails} failed`);
await b.close();
process.exit(fails === 0 ? 0 : 1);
