// A day on one world, from before dawn to after dark.
//
// The thing the exposure change is for. At each step the local clock is moved,
// the renderer is made to draw a frame (software rasterisation gives about one
// a second, and the interface's own numbers lag several behind, so nothing
// here trusts what is painted - the state is read from the stage), the
// aperture is settled, and the frame is measured and kept.
import { chromium } from 'playwright';

const CTX = JSON.parse(process.env.CTX
  ?? '{"cluster":0,"member":0,"star":0,"planet":2,"lat":34}');
const NAME = process.env.NAME ?? 'arkaebel';
const STEPS = 12;

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 760, height: 460 } });
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)));
await page.goto('http://localhost:4173/?seed=ORIGIN&intro=0&n=64', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 300000 });
await page.evaluate(() => { document.getElementById('ui').style.display = 'none'; });
await page.evaluate((c) => window.majveia.travel('surface', c), CTX);
await page.waitForFunction(() => !window.majveia.app.travelling, null, { timeout: 200000 });

/** Make the page actually draw. A screenshot is the only reliable way to. */
const draw = async (n = 1) => {
  for (let i = 0; i < n; i++) {
    await page.screenshot({ clip: { x: 0, y: 0, width: 8, height: 8 } });
  }
};

console.log(`${NAME}: a whole day`);
console.log(' hour   star alt   exposure     sky   ground   black%');
for (let i = 0; i < STEPS; i++) {
  const f = i / STEPS;
  await page.evaluate((x) => { const s = window.majveia.app.stage; s.simTime = s.dayS * x; }, f);
  await draw(2);
  // Settle the aperture rather than waiting out its slew: it is a wall-clock
  // time constant and wall clock here is a second a frame.
  await page.evaluate(() => window.majveia.app.stage.adaptExposure(Infinity));
  await draw(1);
  const st = await page.evaluate(() => {
    const s = window.majveia.app.stage;
    const r = s.rows();
    const g = (k) => r.find((x) => x.k === k)?.v;
    return { alt: g('star altitude'), it: g('it is'), expo: s.exposure, clock: g('local time') };
  });
  const png = (await page.screenshot({ path: `/tmp/day-${NAME}-${String(i).padStart(2, '0')}.png` }))
    .toString('base64');
  const m = await page.evaluate(async (b64) => {
    const raw = atob(b64); const u = new Uint8Array(raw.length);
    for (let k = 0; k < raw.length; k++) u[k] = raw.charCodeAt(k);
    const bmp = await createImageBitmap(new Blob([u], { type: 'image/png' }));
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const g2 = cv.getContext('2d'); g2.drawImage(bmp, 0, 0);
    const d = g2.getImageData(0, 0, cv.width, cv.height).data;
    const w = cv.width, h = cv.height;
    let sky = 0, ns = 0, grd = 0, ng = 0, black = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const l = (d[p] + d[p + 1] + d[p + 2]) / 3;
      if (l < 6) black++;
      if (y < h * 0.45) { sky += l; ns++; } else if (y > h * 0.84) { grd += l; ng++; }
    }
    return { sky: sky / ns, grd: grd / ng, black: (100 * black) / (w * h) };
  }, png);
  console.log(`${String(st.clock).padStart(6)} ${String(st.alt).padStart(8)}°`
    + ` ${st.expo.toFixed(2).padStart(10)} ${m.sky.toFixed(0).padStart(7)}`
    + ` ${m.grd.toFixed(0).padStart(8)} ${m.black.toFixed(1).padStart(8)}   ${st.it}`);
}
await b.close();
