// A moon in the sky: right size, right place, right phase.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 500)));
await page.goto('http://localhost:4173/?seed=ORIGIN&n=64&intro=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
await page.evaluate((c) => window.majveia.travel('surface', JSON.parse(c)), process.argv[3]);
await page.waitForFunction(() => !window.majveia.app.travelling, null, { timeout: 90000 });
// Step forward until a moon is actually up, then look at it.
const wantNight = process.argv[4] === 'night';

// Scan the clock rather than waiting on it: search the next few days of this
// world's own time for a moment when the moon is well up, and if night was
// asked for, when the star is well down.
const found = await page.evaluate((night) => {
  const st = window.majveia.app.stage;
  const t0 = st.simTime;
  const step = 900;
  for (let i = 0; i < 20000; i++) {
    st.simTime = t0 + i * step;
    st.update(0);
    const g = st.view.moons ? st.view.moons.geometry : null;
    const n = g ? g.instanceCount : 0;
    if (!n) continue;
    const d = g.getAttribute('aDir');
    const alt = Math.asin(d.getY(0)) * 180 / Math.PI;
    const sun = Number(st.rows().find((r) => r.k === 'star altitude').v);
    const li0 = g.getAttribute('aLight');
    const full = li0.getZ(0);
    if (alt > 25 && (!night || (sun < -14 && full > 0.75))) {
      // Put the eye at a fixed height and the orbit target out along the
      // moon's bearing, rather than tilting the camera about a fixed target -
      // which buries it underground once the moon is high.
      const c = window.majveia.controls;
      const dx = d.getX(0), dy = d.getY(0), dz = d.getZ(0);
      const t = c.target.clone();
      t.set(dx * 26, 2 + dy * 26, dz * 26);
      c.snapTo(t, 26, Math.atan2(-dx, -dz), Math.acos(-dy));
      window.majveia.app.engine.camera.fov = 22;
      window.majveia.app.engine.camera.updateProjectionMatrix();
      const col = g.getAttribute('aColor'), li = g.getAttribute('aLight');
      return {
        hours: +((st.simTime - t0) / 3600).toFixed(1), alt: +alt.toFixed(1), sun,
        widthDeg: +(g.getAttribute('aAng').getX(0) * 2 * 180 / Math.PI).toFixed(3),
        color: [col.getX(0), col.getY(0), col.getZ(0)].map((x) => +x.toFixed(4)),
        light: [li.getX(0), li.getY(0), li.getZ(0)].map((x) => +x.toFixed(3)),
        dist: st.view.moons.material.uniforms.uDist.value,
        visible: st.view.moons.visible, order: st.view.moons.renderOrder,
        camFar: window.majveia.app.engine.camera.far,
      };
    }
  }
  return null;
}, wantNight);
console.log(JSON.stringify(found));
// Stop the clock, or the moon drifts out of frame while the shot is taken.
await page.evaluate(() => window.majveia.app.runKey('Space'));
await page.waitForTimeout(1500);
// Re-aim after the pause: the camera keeps easing and drifting for a second
// or so after a snap, and by the time the shot is taken it has wandered.
await page.evaluate(() => {
  const st = window.majveia.app.stage;
  const d = st.view.moons.geometry.getAttribute('aDir');
  const dx = d.getX(0), dy = d.getY(0), dz = d.getZ(0);
  const c = window.majveia.controls;
  c.drift = 0;
  const t = c.target.clone();
  t.set(dx * 26, 2 + dy * 26, dz * 26);
  c.snapTo(t, 26, Math.atan2(-dx, -dz), Math.acos(-dy));
  window.majveia.app.engine.camera.fov = 18;
  window.majveia.app.engine.camera.updateProjectionMatrix();
});
await page.waitForTimeout(1200);
console.log('where it should be:', JSON.stringify(await page.evaluate(() => {
  const st = window.majveia.app.stage;
  const cam = window.majveia.app.engine.camera;
  const g = st.view.moons.geometry, d = g.getAttribute('aDir');
  const dir = { x: d.getX(0), y: d.getY(0), z: d.getZ(0) };
  const v = cam.position.clone();
  v.set(dir.x, dir.y, dir.z).multiplyScalar(3e5).add(cam.position);
  v.project(cam);
  const look = cam.getWorldDirection(cam.position.clone().set(0, 0, 0));
  return {
    ndc: [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(4)],
    fov: cam.fov, instances: g.instanceCount,
    dot: +(look.x * dir.x + look.y * dir.y + look.z * dir.z).toFixed(3),
    camY: +cam.position.y.toFixed(2),
  };
})));
const shot = (await page.screenshot()).toString('base64');
console.log('brightest near centre:', JSON.stringify(await page.evaluate(async (b64) => {
  const img = new Image();
  await new Promise((r) => { img.onload = r; img.src = 'data:image/png;base64,' + b64; });
  const o = document.createElement('canvas');
  o.width = img.width; o.height = img.height;
  const g = o.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, o.width, o.height).data;
  let best = -1, at = null;
  for (let i = 0; i < o.width * o.height; i++) {
    const v = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2];
    if (v > best) { best = v; at = [i % o.width, (i / o.width) | 0]; }
  }
  const k = (at[1] * o.width + at[0]) * 4;
  return { sum: best, px: [d[k], d[k + 1], d[k + 2]], at, size: [o.width, o.height] };
}, shot)));
await page.screenshot({ path: process.argv[2] });
await b.close();
