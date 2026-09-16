// What is out there to stand on, without rendering any of it.
//
// The whole universe is a pure function of the seed, so the planets exist
// whether or not anything has drawn them. This asks the object graph directly
// and comes back with a list of places worth visiting, which is much cheaper
// than flying to each one to find out it is a gas giant.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 800, height: 600 } });
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)));
const seed = process.argv[2] ?? 'ORIGIN';
await page.goto(`http://localhost:4173/?seed=${seed}&intro=0&n=64`, { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 300000 });

const found = await page.evaluate(({ stars }) => {
  const u = window.majveia.app.universe;
  const g = u.galaxy(0, 0);
  const out = [];
  for (let s = 0; s < stars; s++) {
    let sys;
    try { sys = u.system(g, s); } catch { continue; }
    const st = sys.system.star;
    sys.system.planets.forEach((p, i) => {
      out.push({
        star: s, planet: i, name: p.name, cls: p.cls,
        au: +p.au.toFixed(3), teq: Math.round(p.surfaceK),
        bar: +p.pressureBar.toFixed(3), air: p.atmosphere,
        g: +(p.gravity / 9.80665).toFixed(2),
        moons: p.moons.length, day: p.dayS, locked: !!p.tidallyLocked,
        starKind: `${st.spectralClass}${st.subClass} ${st.luminosityClass}`,
        starT: Math.round(st.teff), sysName: sys.name,
        water: p.hydrosphere ?? null, ice: p.iceFraction ?? null,
      });
    });
  }
  return out;
}, { stars: Number(process.argv[3] ?? 40) });

// Only the ones with a surface: below the giants, and worth walking on.
const GIANTS = new Set(['mini-neptune', 'ice-giant', 'gas-giant', 'hot-jupiter', 'puffy']);
const solid = found.filter((p) => !GIANTS.has(p.cls));
const byClass = new Map();
for (const p of solid) {
  if (!byClass.has(p.cls)) byClass.set(p.cls, []);
  byClass.get(p.cls).push(p);
}
console.log(`seed ${seed}: ${found.length} planets, ${solid.length} with a surface\n`);
for (const [cls, list] of [...byClass].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${cls.padEnd(13)} ${String(list.length).padStart(3)}  e.g. ` + list.slice(0, 3).map((p) =>
    `${p.name} (★${p.star}·p${p.planet} ${p.teq}K ${p.bar}bar ${p.g}g ${p.moons}m`
    + `${p.locked ? ' locked' : ''})`).join('  '));
}
// Giants have moons, and a moon is a world like any other.
const withMoons = found.filter((p) => GIANTS.has(p.cls) && p.moons > 0);
console.log(`\ngiants with moons: ${withMoons.length}  e.g. `
  + withMoons.slice(0, 4).map((p) => `${p.name} (★${p.star}·p${p.planet}, ${p.moons})`).join('  '));
await b.close();
