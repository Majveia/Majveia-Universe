// Does the light cone actually change the picture, and in the shape it should?
//
// Takes the same camera twice - once on a snapshot, once on the observer's past
// light cone - and differences the two. The overall number is not the
// interesting one. The interesting one is the trend with distance from the
// observer, because that is the only thing the cone claims: structure caught
// earlier, further out, and therefore less collapsed.
//
// Writes /tmp/diff-snap.png and /tmp/diff-cone.png for looking at.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 900, height: 620 } });
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)));
await page.goto('http://localhost:4173/?seed=ORIGIN&intro=0&n=128', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 300000 });
await page.waitForTimeout(4000);
// Hold the clock still and take the interface out of the frame, or its own
// pixels end up in the measurement - and they sit at the edges, which is
// exactly where the effect is supposed to live.
await page.evaluate(() => {
  window.majveia.app.runKey('Space');
  document.getElementById('ui').style.display = 'none';
  for (const e of document.querySelectorAll('.help, .hint, .inspector')) e.style.display = 'none';
});
// Stand back, so one frame holds a wide range of cone distance.
await page.evaluate(() => { const c = window.majveia.app.controls;
  c.maxDistance *= 6; c.snapTo(c.target, c.distance * 3.0, c.theta, c.phi); });
await page.waitForTimeout(4000);

const shot = async (name) => {
  const png = await page.screenshot();
  writeFileSync(`/tmp/diff-${name}.png`, png);
  return png.toString('base64');
};
const snap = await shot('snap');
await page.evaluate(() => window.majveia.app.runKey('Quote'));
await page.waitForTimeout(3000);
const cone = await shot('cone');

// Decoded and differenced in the page, so the probe needs no image library.
const r = await page.evaluate(async ([a, c]) => {
  const pixels = async (b64) => {
    // Through a blob rather than a data URL: a nine-hundred-pixel frame is
    // over a megabyte of base64 and the browser will not load that as a src.
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const g = cv.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return g.getImageData(0, 0, cv.width, cv.height);
  };
  const A = await pixels(a), C = await pixels(c);
  const w = A.width, h = A.height, n = w * h;
  // Five rings out from the middle of the frame, which is roughly where the
  // observer is standing.
  const ring = Array.from({ length: 5 }, () => ({ a: 0, c: 0, n: 0 }));
  let sa = 0, sc = 0, changed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const la = (A.data[i] + A.data[i + 1] + A.data[i + 2]) / 3;
      const lc = (C.data[i] + C.data[i + 1] + C.data[i + 2]) / 3;
      sa += la; sc += lc;
      if (Math.abs(la - lc) > 6) changed++;
      const k = Math.min(4, Math.floor((Math.hypot(x - w / 2, y - h / 2) / (h / 2)) * 3));
      ring[k].a += la; ring[k].c += lc; ring[k].n++;
    }
  }
  return { meanA: sa / n, meanC: sc / n, changed: (100 * changed) / n, ring };
}, [snap, cone]);

console.log(`mean luminance   snapshot ${r.meanA.toFixed(2)}   cone ${r.meanC.toFixed(2)}`
  + `   cone/snapshot ${(r.meanC / r.meanA).toFixed(3)}`);
console.log(`pixels changed by more than 6/255: ${r.changed.toFixed(1)}%`);
let previous = Infinity, monotone = true;
for (let k = 0; k < r.ring.length; k++) {
  const { a, c, n } = r.ring[k];
  if (!n) continue;
  const ratio = c / a;
  console.log(`  ring ${k}   snapshot ${(a / n).toFixed(2).padStart(7)}`
    + `   cone ${(c / n).toFixed(2).padStart(7)}   cone/snapshot ${ratio.toFixed(3)}`);
  // The corners of the frame are mostly empty sky and too noisy to judge.
  if (k < 4) { if (ratio > previous + 1e-9) monotone = false; previous = ratio; }
}
console.log(monotone
  ? '\nthe cone dims structure further from the observer, monotonically'
  : '\nFAIL: the trend with distance is not there');
await b.close();
process.exit(monotone ? 0 : 1);
