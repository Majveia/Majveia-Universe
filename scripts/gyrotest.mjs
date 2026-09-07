// Turn an emulated phone and check the camera follows. Chrome can override the
// orientation sensors through the debugging protocol, so the whole viewfinder
// path - permission, listener, quaternion, orbit - runs for real.
import { chromium, devices } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await browser.newContext({
  ...devices['iPhone 13'], deviceScaleFactor: 1, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)));
await page.goto('http://localhost:4173/?seed=ORIGIN&touch=1&n=64', { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
await page.waitForTimeout(6000);

const cdp = await ctx.newCDPSession(page);
const pose = (alpha, beta, gamma) =>
  cdp.send('DeviceOrientation.setDeviceOrientationOverride', { alpha, beta, gamma });
const wait = (ms) => page.waitForTimeout(ms);
const cam = () => page.evaluate(() => {
  const c = window.majveia.controls;
  const p = window.majveia.engine.camera.position;
  return { th: c.theta, phi: c.phi, on: c.viewfinder, pos: [p.x, p.y, p.z] };
});

let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) fails++;
};

// Hold the phone upright, facing the device's zero heading.
await pose(0, 90, 0);
await page.evaluate(() => window.majveia.app.runKey('KeyX'));
await wait(1400);
check('the viewfinder switches on', (await cam()).on);

// Turning the body a quarter turn walks the camera a quarter of the way round.
const a = await cam();
await pose(90, 90, 0);
await wait(1600);
const b = await cam();
const turned = Math.abs(b.th - a.th);
check('a quarter turn walks a quarter way round',
  Math.abs(turned - Math.PI / 2) < 0.25, `${turned.toFixed(3)} rad`);

// Tilting the phone toward the floor raises the camera above what it is on.
const c1 = await cam();
await pose(90, 40, 0);
await wait(1600);
const c2 = await cam();
check('tilting down raises the camera', c2.phi < c1.phi - 0.15,
  `phi ${c1.phi.toFixed(3)} -> ${c2.phi.toFixed(3)}`);

// Crossing the device's zero heading must take the short way, not spin.
await pose(5, 90, 0);
await wait(1600);
const d1 = await cam();
await pose(355, 90, 0);
await wait(1600);
const d2 = await cam();
check('crossing north takes the short way', Math.abs(d2.th - d1.th) < 0.6,
  `${Math.abs(d2.th - d1.th).toFixed(3)} rad for ten degrees`);

// A finger must not fight the sensor while it is aiming.
const e1 = await cam();
await page.evaluate(() => window.majveia.controls.orbitBy(400, 0));
await wait(900);
const e2 = await cam();
check('dragging does not fight the sensor', Math.abs(e2.th - e1.th) < 0.05);

// And switching it off gives the camera back.
await page.evaluate(() => window.majveia.app.runKey('KeyX'));
await wait(600);
const f1 = await cam();
await page.evaluate(() => window.majveia.controls.orbitBy(400, 0));
await wait(900);
const f2 = await cam();
check('switching off returns control', !f1.on && Math.abs(f2.th - f1.th) > 0.5,
  `theta moved ${(f2.th - f1.th).toFixed(3)}`);

console.log(fails === 0 ? '\nthe viewfinder behaves' : `\n${fails} failed`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
