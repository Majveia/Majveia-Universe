// Drive the touch interface with real multi-touch events and check that the
// camera did what the gesture asked. Playwright's own API is single-touch, so
// the contacts are dispatched through the debugging protocol directly.
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
await page.evaluate(() => {
  const c = window.majveia.controls;
  window.__g = { tap: 0, dbl: 0, back: 0, long: 0 };
  const t = c.onTap, d = c.onDoubleTap, b = c.onTwoFingerTap, l = c.onLongPress;
  c.onTap = (x, y) => { window.__g.tap++; t?.(x, y); };
  c.onDoubleTap = (x, y) => { window.__g.dbl++; d?.(x, y); };
  c.onTwoFingerTap = () => { window.__g.back++; b?.(); };
  c.onLongPress = (x, y) => { window.__g.long++; l?.(x, y); };
});

const cdp = await ctx.newCDPSession(page);
const pt = (x, y, id) => ({ x, y, id, radiusX: 12, radiusY: 12, force: 1 });
// Explicit timestamps. Without them the events are stamped when the browser
// gets round to dispatching them, and a round trip through the debugging
// protocol on a software renderer is half a second - so every tap the harness
// tries to make arrives looking like a deliberate hold.
let clock = Date.now() / 1000;
const send = (type, points, dt = 0.02) => {
  clock += dt;
  return cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points, timestamp: clock });
};
// touchEnd must name the contacts that were released, not be handed an empty
// list: an empty one leaves the page believing the fingers are still down.
const lift = (points, dt = 0.02) => send('touchEnd', points, dt);
const wait = (ms) => page.waitForTimeout(ms);
const state = () => page.evaluate(() => ({
  d: window.majveia.controls.distance,
  th: window.majveia.controls.theta,
  min: window.majveia.controls.minDistance,
  max: window.majveia.controls.maxDistance,
  scale: window.majveia.app.stage.id,
}));
const flash = () => page.evaluate(() => document.querySelector('.flash').textContent);
const crumb = () => page.evaluate(() => document.querySelector('.masthead h1').textContent);

let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) fails++;
};

// --- Pinch out: two fingers spreading must reduce the orbit radius.
{
  const a = await state();
  await send('touchStart', [pt(150, 300, 0), pt(240, 300, 1)]);
  for (let i = 1; i <= 8; i++) {
    await send('touchMove', [pt(150 - i * 10, 300, 0), pt(240 + i * 10, 300, 1)]);
    await wait(16);
  }
  await lift([pt(70, 300, 0), pt(320, 300, 1)]);
  await wait(600);
  const b = await state();
  check('pinch out zooms in', b.d < a.d * 0.85, `${a.d.toFixed(2)} -> ${b.d.toFixed(2)}`);
}

// --- Pinch in: the same fingers closing must undo it.
{
  const a = await state();
  await send('touchStart', [pt(60, 300, 0), pt(300, 300, 1)]);
  for (let i = 1; i <= 8; i++) {
    await send('touchMove', [pt(60 + i * 11, 300, 0), pt(300 - i * 11, 300, 1)]);
    await wait(16);
  }
  await lift([pt(148, 300, 0), pt(212, 300, 1)]);
  await wait(600);
  const b = await state();
  check('pinch in zooms out', b.d > a.d * 1.15,
    `${a.d.toFixed(2)} -> ${b.d.toFixed(2)}  (limits ${a.min.toExponential(1)}..${a.max.toFixed(1)})`);
}

// --- One finger drags the sky round.
{
  const a = await state();
  await send('touchStart', [pt(200, 300, 0)]);
  for (let i = 1; i <= 8; i++) { await send('touchMove', [pt(200 + i * 14, 300, 0)]); await wait(16); }
  await lift([pt(312, 300, 0)]);
  await wait(700);
  const b = await state();
  check('one finger orbits', Math.abs(b.th - a.th) > 0.1,
    `theta ${a.th.toFixed(3)} -> ${b.th.toFixed(3)}`);
}

// --- A flick keeps going after the finger has gone.
{
  await send('touchStart', [pt(120, 320, 0)]);
  for (let i = 1; i <= 6; i++) { await send('touchMove', [pt(120 + i * 30, 320, 0)]); await wait(16); }
  await lift([pt(300, 320, 0)]);
  const a = await state();
  await wait(500);
  const b = await state();
  check('a flick carries on', Math.abs(b.th - a.th) > 0.01,
    `theta moved ${(b.th - a.th).toFixed(4)} after release`);
}

// --- Double tap descends a scale.
{
  const before = await crumb();
  for (const t of [0, 1]) {
    await send('touchStart', [pt(195, 300, 10 + t)]);
    await lift([pt(195, 300, 10 + t)], 0.05);
    await wait(60);
  }
  const said = await flash();
  console.log('      verbs seen:', JSON.stringify(await page.evaluate(() => window.__g)));
  await wait(4500);
  const after = await crumb();
  check('double tap reaches the app', after !== before || /descend/.test(said),
    `${before} -> ${after}  flash: "${said}"`);

  // --- Two-finger tap climbs back out.
  await send('touchStart', [pt(150, 320, 20)]);
  await send('touchStart', [pt(150, 320, 20), pt(230, 320, 21)], 0.02);
  await lift([pt(150, 320, 20)], 0.06);
  await lift([pt(230, 320, 21)], 0.02);
  await wait(4500);
  const back = await crumb();
  check('two-finger tap ascends', back === before, `${after} -> ${back}`);
}

// --- The shelf opens on a tap of its grabber.
{
  const box = await page.evaluate(() => {
    const g = document.querySelector('.m-grip').getBoundingClientRect();
    return { x: g.x + g.width / 2, y: g.y + g.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.up();
  await wait(600);
  const open = await page.evaluate(() =>
    document.querySelector('.m-shelf').classList.contains('open'));
  check('the shelf opens', open);
}

console.log(fails === 0 ? '\nall gestures behave' : `\n${fails} failed`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
