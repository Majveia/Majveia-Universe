// Go and stand on them.
//
// Not a health check and not a unit test: this is the thing itself, visited.
// Each entry names a world, a latitude and a time of day; the probe travels
// there, moves the local clock, settles the aperture, keeps a frame, and
// measures what is in it.
//
// Two things about the measuring. The frame is what the renderer drew, but the
// interface painted over it is several frames stale - a surface scene costs
// about a second a frame on a software rasteriser and the readout is written
// every sixth one - so nothing here reads a number off the picture. It asks
// the stage. And a screenshot is the only reliable way to make the page draw
// at all, which is why `draw()` takes throwaway ones.
//
// The columns to watch are `sky` and `grd`: mean display luminance of the top
// of the frame and the bottom, out of 255. Before the exposure model included
// the sky's own light and the star's real altitude, every daylit world on this
// list sat between 106 and 243 with the ground brighter than the sky that was
// lighting it. There was no black anywhere and no tonal range at all.
import { chromium } from 'playwright';

const SEED = process.env.SEED ?? 'ORIGIN';
const BASE = { cluster: 0, member: 0 };
const SHOTS = !process.argv.includes('--no-shots');

// star · planet · latitude · fraction of the local day · what it is
const PLACES = process.env.PLACES ? JSON.parse(process.env.PLACES) : [
  ['arkaebel-noon',  { star: 0, planet: 2, lat: 34 }, 0.50, 'terrestrial, 333 K, two moons'],
  ['arkaebel-dusk',  { star: 0, planet: 2, lat: 34 }, 0.76, 'the same world, an hour from sunset'],
  ['arkaebel-night', { star: 0, planet: 2, lat: 34 }, 0.92, 'the same world, well after dark'],
  ['lyrarrid-ocean', { star: 32, planet: 6, lat: 12 }, 0.45, 'ocean, 313 K, one gravity'],
  ['taljor-desert',  { star: 13, planet: 6, lat: 22 }, 0.40, 'desert, 232 K'],
  ['ridzor-ice',     { star: 4, planet: 9, lat: 62 }, 0.35, 'ice, 205 K, 11% of the light gets down'],
  ['urfarjor-lava',  { star: 2, planet: 0, lat: 8 }, 0.50, 'lava, 869 K, a star 12° wide'],
  ['belnorhal-thin', { star: 26, planet: 2, lat: 40 }, 0.50, 'terrestrial, locked, 0.14 bar'],
  ['taljor-tundra',  { star: 13, planet: 7, lat: 70 }, 0.30, 'tundra, 7 bar, no star visible at all'],
  ['arkaebel-moon',  { star: 0, planet: 3, moon: 0, lat: 20 }, 0.50, 'an airless moon under its giant'],
];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1000, height: 560 } });
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)));
await page.goto(`http://localhost:4173/?seed=${SEED}&intro=0&n=64`, { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 300000 });
await page.evaluate(() => { document.getElementById('ui').style.display = 'none'; });

/** Make the page actually draw. A screenshot is the only thing that will. */
const draw = async (n = 1) => {
  for (let i = 0; i < n; i++) await page.screenshot({ clip: { x: 0, y: 0, width: 8, height: 8 } });
};

const measure = async (png) => page.evaluate(async (b64) => {
  const raw = atob(b64); const u = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([u], { type: 'image/png' }));
  const cv = document.createElement('canvas');
  cv.width = bmp.width; cv.height = bmp.height;
  const g = cv.getContext('2d'); g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  const w = cv.width, h = cv.height;
  let sky = 0, ns = 0, grd = 0, ng = 0, white = 0, black = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (l > 247) white++; else if (l < 6) black++;
    if (y < h * 0.45) { sky += l; ns++; } else if (y > h * 0.84) { grd += l; ng++; }
  }
  return { sky: sky / ns, grd: grd / ng,
    white: (100 * white) / (w * h), black: (100 * black) / (w * h) };
}, png);

console.log('place            expo    sky   grd  white%  black%   what the stage says');
let fails = 0;
for (const [name, ctx, dayFraction, note] of PLACES) {
  await page.evaluate((c) => window.majveia.travel('surface', c), { ...BASE, ...ctx });
  await page.waitForFunction(() => !window.majveia.app.travelling, null, { timeout: 200000 });
  await draw(1);
  await page.evaluate((f) => { const s = window.majveia.app.stage; s.simTime = s.dayS * f; },
    dayFraction);
  await draw(2);
  // Settle the aperture rather than waiting out its slew: that is a wall-clock
  // time constant and wall clock in here is a second a frame.
  await page.evaluate(() => window.majveia.app.stage.adaptExposure(Infinity));
  await draw(1);
  const st = await page.evaluate(() => {
    const s = window.majveia.app.stage, r = s.rows();
    const g = (k) => r.find((x) => x.k === k)?.v;
    return { title: s.title, expo: s.exposure, alt: g('star altitude'),
      clock: g('local time'), it: g('it is') };
  });
  const png = (await page.screenshot(SHOTS ? { path: `/tmp/visit-${name}.png` } : {}))
    .toString('base64');
  const m = await measure(png);
  console.log(`${name.padEnd(16)} ${st.expo.toFixed(2).padStart(5)}`
    + ` ${m.sky.toFixed(0).padStart(6)} ${m.grd.toFixed(0).padStart(5)}`
    + ` ${m.white.toFixed(1).padStart(6)} ${m.black.toFixed(1).padStart(7)}`
    + `   ${st.title} · ${st.alt}° · ${st.it}`);
  // Nothing on a lit world may be a blank sheet of paper or a blank sheet of
  // nothing. Night is allowed to be black; that is what night is.
  const lit = !name.endsWith('night') && !name.endsWith('moon');
  if (lit && (m.white > 2 || m.black > 20)) {
    console.log(`     FAIL  ${name}: ${m.white.toFixed(1)}% white, ${m.black.toFixed(1)}% black`);
    fails++;
  }
  void note;
}
console.log(fails === 0 ? '\nevery lit world has a picture in it' : `\n${fails} failed`);
await b.close();
process.exit(fails === 0 ? 0 : 1);
