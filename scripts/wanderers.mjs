// The rest of the sky: the other planets where they really are, the sibling
// moons, and whatever gets in front of the star.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 400)));
await page.goto('http://localhost:4173/?real=1&intro=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });

const settle = async () => {
  await page.waitForFunction(() => !window.majveia.app.travelling, null, { timeout: 90000 });
};
const go = async (ctx) => {
  // 'best' means: let the world itself hand you the moon it would, the way
  // descending from a gas giant does. That needs the world stage to be stood
  // up first, so it is two trips.
  if (ctx.moon === 'best') {
    await page.evaluate((c) => window.majveia.travel('world', { ...c, moon: undefined }), ctx);
    await settle();
    const mi = await page.evaluate(() => window.majveia.app.stage.child()?.ctx.moon ?? -1);
    ctx = { ...ctx, moon: mi };
  }
  await page.evaluate((c) => window.majveia.travel('surface', c), ctx);
  await settle();
  await page.waitForTimeout(900);
};
const R = { real: true, cluster: 0, member: 0, star: 0 };
const places = [
  ['Earth',   { ...R, planet: 2, lat: 34 }],
  ['Mars',    { ...R, planet: 3, lat: 22 }],
  ['Mercury', { ...R, planet: 0, lat: 20 }],
  ['Europa',  { ...R, planet: 4, moon: 1, lat: 26 }],
  ['Titan',   { ...R, planet: 5, moon: 'best', lat: 26 }],
];
for (const [name, ctx] of places) {
  await go(ctx);
  const r = await page.evaluate(() => {
    const st = window.majveia.app.stage;
    return { title: st.title, rows: st.rows().map((x) => `${x.k} = ${x.v}${x.u ?? ''}`) };
  });
  console.log(`\n=== ${name} (${r.title}) ===`);
  console.log(r.rows.join('\n'));
}

// The decisive check on morning and evening. A morning star is up at dawn and
// down at dusk, and the label has to agree with that at every point of the
// synodic cycle - not just at one convenient hour.
await go({ ...R, planet: 2, lat: 34 });
console.log('\n=== is a morning star actually up in the morning? (Venus from Earth) ===');
const check = await page.evaluate(() => {
  const st = window.majveia.app.stage;
  const DAY = st.dayS, out = [];
  // Step a month at a time through a year and a half - past two conjunctions.
  for (let k = 0; k < 18; k++) {
    const base = k * 30 * DAY;
    // Find dawn and dusk on that day by scanning the star's altitude.
    let dawn = -1, dusk = -1, prev = null;
    for (let j = 0; j <= 200; j++) {
      st.simTime = base + (j / 200) * DAY;
      st.aim();
      const a = st.altitude;
      if (prev !== null && prev < 0 && a >= 0) dawn = st.simTime;
      if (prev !== null && prev >= 0 && a < 0) dusk = st.simTime;
      prev = a;
    }
    const look = (t) => {
      st.simTime = t; st.aim(); st.placeMoons(); st.placeWanderers();
      const v = st.wanderers.find((w) => w.name === 'Venus');
      const row = st.rows().find((r) => r.k === 'Venus');
      return v ? {
        alt: (v.altitude * 180) / Math.PI,
        el: (v.elongationRad * 180) / Math.PI,
        label: row ? row.v : '(below the horizon)',
      } : null;
    };
    // An hour before sunrise, and an hour after sunset.
    const m = look(dawn - 3600), e = look(dusk + 3600);
    // Read the label at the moment the planet is actually up, which is the
    // only moment the readout would ever be showing it.
    const label = (m && m.alt > 0 ? m.label : null) ?? (e && e.alt > 0 ? e.label : null);
    out.push({
      month: k, label: label ?? '(not up at either end of the night)',
      preDawnAlt: m ? m.alt.toFixed(0) : '?',
      postDuskAlt: e ? e.alt.toFixed(0) : '?',
      el: m ? m.el.toFixed(0) : '?',
    });
  }
  return out;
});
let bad = 0;
for (const c of check) {
  const said = /morning/.test(c.label) ? 'morning' : /evening/.test(c.label) ? 'evening' : '-';
  const truth = Number(c.preDawnAlt) > 0 && Number(c.postDuskAlt) < 0 ? 'morning'
    : Number(c.postDuskAlt) > 0 && Number(c.preDawnAlt) < 0 ? 'evening' : '-';
  const ok = said === '-' || truth === '-' || said === truth;
  if (!ok) bad++;
  console.log(`month ${String(c.month).padStart(2)}  elong ${String(c.el).padStart(3)}°  `
    + `before dawn ${String(c.preDawnAlt).padStart(4)}°  after dusk ${String(c.postDuskAlt).padStart(4)}°  `
    + `says ${said.padEnd(8)} is ${truth.padEnd(8)} ${ok ? 'ok' : 'WRONG'}`);
}
console.log(bad === 0 ? '\nevery apparition labelled correctly' : `\n${bad} WRONG`);

// Europa's brothers and sisters, over one of its days.
await go({ ...R, planet: 4, moon: 1, lat: 26 });
console.log('\n=== the other moons, from Europa, over one orbit ===');
const sib = await page.evaluate(() => {
  const st = window.majveia.app.stage, out = [];
  for (let k = 0; k <= 12; k++) {
    st.simTime = (k / 12) * st.dayS;
    st.aim(); st.placeMoons(); st.placeWanderers(); st.applyLight();
    out.push([(k / 12 * st.dayS / 3600).toFixed(1) + 'h',
      st.siblingSky.filter((m) => m.alt > 0)
        .map((m) => `${m.name} ${m.wideDeg.toFixed(2)}° ${m.lit * 100 | 0}% at ${m.alt | 0}°`)
        .join(' · ') || '(none up)']);
  }
  return out;
});
for (const r of sib) console.log(r[0].padEnd(8) + r[1]);

// And the eclipse, at the point of Europa that Jupiter stands over.
await go({ ...R, planet: 4, moon: 1, lat: 3 });
console.log('\n=== noon at the sub-Jupiter point of Europa ===');
const ecl = await page.evaluate(() => {
  const st = window.majveia.app.stage, out = [];
  const P = st.dayS;
  for (let k = -14; k <= 14; k++) {
    st.simTime = P * 0.5 + k * 900;
    st.aim(); st.placeMoons(); st.placeWanderers(); st.applyLight();
    out.push([`${(k * 15) / 60 >= 0 ? '+' : ''}${((k * 15) / 60).toFixed(2)}h`,
      (st.eclipseCover * 100).toFixed(1) + '%', (st.eclipse * 100).toFixed(2) + '%']);
  }
  return out;
});
console.log('from noon    covered   light');
for (const r of ecl) console.log(r.map((x) => String(x).padEnd(12)).join(''));

// Pictures.
const shots = [
  ['/tmp/sky-earth.png', { ...R, planet: 2, lat: 34 }, 0.79],
  ['/tmp/sky-europa.png', { ...R, planet: 4, moon: 1, lat: 26 }, null],
  ['/tmp/sky-eclipse.png', { ...R, planet: 4, moon: 1, lat: 3 }, 0.5],
];
for (const [f, ctx, frac] of shots) {
  await go(ctx);
  if (frac !== null) {
    await page.evaluate((x) => {
      const st = window.majveia.app.stage;
      st.simTime = st.dayS * x;
    }, frac);
  }
  await page.waitForTimeout(1600);
  await page.screenshot({ path: f });
}
await b.close();
