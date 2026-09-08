// What is actually on the glass, in numbers.
import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 400)));
await page.goto('http://localhost:4173/?seed=ORIGIN&n=64&intro=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
await page.evaluate((c) => window.majveia.travel('surface', JSON.parse(c)),
  process.argv[2] ?? '{"cluster":0,"member":0,"star":0,"real":1,"planet":2,"lat":34}');
await page.waitForTimeout(8000);
// The WebGL buffer is not preserved after compositing, so read the pixels
// back out of a screenshot instead of off the live canvas.
const shot = (await page.screenshot()).toString('base64');
console.log(JSON.stringify(await page.evaluate(async (b64) => {
  const img = new Image();
  await new Promise((r) => { img.onload = r; img.src = 'data:image/png;base64,' + b64; });
  const o = document.createElement('canvas');
  o.width = img.width; o.height = img.height;
  const g = o.getContext('2d');
  g.drawImage(img, 0, 0);
  const at = (fx, fy) => {
    const d = g.getImageData(Math.floor(fx * o.width), Math.floor(fy * o.height), 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  // Sweep the ground band: if the terrain is shaded at all, these vary.
  const scan = (fy) => {
    const v = [];
    for (let i = 0; i < 24; i++) v.push(at(0.03 + 0.94 * (i / 23), fy)[1]);
    return { min: Math.min(...v), max: Math.max(...v), row: v.filter((_, i) => i % 4 === 0) };
  };
  return {
    size: [o.width, o.height],
    zenith: at(0.5, 0.04), skyMid: at(0.5, 0.25), skyLow: at(0.5, 0.44),
    horizon: at(0.5, 0.50), groundFar: at(0.5, 0.56), groundMid: at(0.5, 0.75),
    groundNear: at(0.5, 0.96),
    scanFar: scan(0.62), scanMid: scan(0.78), scanNear: scan(0.94),
    exposure: +window.majveia.app.stage.view.ground.material.uniforms.uExposure.value.toFixed(2),
  };
}, shot)));
await browser.close();
