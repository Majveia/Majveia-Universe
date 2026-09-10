// Double tap, at every scale, everywhere on the glass. Descending is the verb
// this whole application is about, and on a phone it is the one that has no
// keyboard fallback - so it has to work from an arbitrary place on the screen,
// not only when a finger lands exactly on a star.
import { chromium, devices } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')];
}));

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
  window.__g = { tap: 0, dbl: 0, long: 0 };
  const t = c.onTap, d = c.onDoubleTap, l = c.onLongPress;
  c.onTap = (x, y) => { window.__g.tap++; t?.(x, y); };
  c.onDoubleTap = (x, y) => { window.__g.dbl++; d?.(x, y); };
  c.onLongPress = (x, y) => { window.__g.long++; l?.(x, y); };
});

const cdp = await ctx.newCDPSession(page);
let clock = Date.now() / 1000;
const pt = (x, y, id) => ({ x, y, id, radiusX: 12, radiusY: 12, force: 1 });
const send = (type, points, dt = 0.02) => {
  clock += dt;
  return cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points, timestamp: clock });
};
const wait = (ms) => page.waitForTimeout(ms);
const scale = () => page.evaluate(() => window.majveia.app.stage?.id);
const flash = () => page.evaluate(() => document.querySelector('.flash')?.textContent ?? '');

let id = 100;
async function doubleTap(x, y) {
  for (let i = 0; i < 2; i++) {
    id++;
    await send('touchStart', [pt(x, y, id)]);
    await send('touchEnd', [pt(x, y, id)], 0.05);
    await wait(50);
    clock += 0.06;
  }
  await wait(+(args.settle ?? 6000));
}

let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) fails++;
};

// Down the whole ladder, tapping somewhere arbitrary each time - not on
// anything in particular, which is the realistic case on a phone.
const spots = [[120, 240], [260, 420], [195, 180], [44, 726]];
const want = ['cluster', 'galaxy', 'system', 'world'];
for (let i = 0; i < want.length; i++) {
  const before = await scale();
  await doubleTap(spots[i][0], spots[i][1]);
  const after = await scale();
  const g = await page.evaluate(() => window.__g);
  const insp = await page.evaluate(() =>
    document.querySelector('.inspector')?.classList.contains('show'));
  check(`double tap enters ${want[i]} from ${before}`, after === want[i],
    `${before} -> ${after}  "${await flash()}"  verbs=${JSON.stringify(g)} inspector=${insp}`);
  if (after !== want[i]) break;
}

// And the last rung.
//
// Not every world has one: a gas giant is gas all the way down and the ladder
// legitimately ends there, so the walk above can finish on one. Land on a
// world that does have a surface, and check the gesture takes you onto it.
// travel() is refused outright while a scale change is still in flight, so
// wait for the last one to land before asking for another.
await page.waitForFunction(() => !window.majveia.app.travelling, null, { timeout: 60000 });
await page.evaluate(() => window.majveia.travel('world',
  { cluster: 0, member: 0, star: 0, real: 1, planet: 2 }));
await page.waitForFunction(() => window.majveia.app.stage?.title === 'Earth', null, { timeout: 60000 });
await page.waitForTimeout(3000);
check('a rocky world has somewhere to stand',
  await page.evaluate(() => !!window.majveia.app.stage.child()));
await doubleTap(200, 300);
check('double tap enters surface from world', (await scale()) === 'surface',
  `-> ${await scale()}  "${await flash()}"`);
check('the surface hands you the ground under it',
  await page.evaluate(() => window.majveia.app.stage.child()?.id === 'matter'),
  `-> ${await page.evaluate(() => JSON.stringify(window.majveia.app.stage.child()))}`);
await doubleTap(200, 300);
check('double tap enters matter from surface', (await scale()) === 'matter',
  `-> ${await scale()}  "${await flash()}"`);
check('the lattice hands you one of its atoms',
  await page.evaluate(() => window.majveia.app.stage.child()?.id === 'atom'),
  `-> ${await page.evaluate(() => window.majveia.app.stage.child()?.label)}`);
await doubleTap(200, 300);
check('double tap enters atom from matter', (await scale()) === 'atom',
  `-> ${await scale()}  "${await flash()}"`);
check('the atom hands you its nucleus',
  await page.evaluate(() => window.majveia.app.stage.child()?.id === 'nucleus'),
  `-> ${await page.evaluate(() => window.majveia.app.stage.child()?.label)}`);
await doubleTap(200, 300);
check('double tap enters nucleus from atom', (await scale()) === 'nucleus',
  `-> ${await scale()}  "${await flash()}"`);
check('and there the ladder ends',
  await page.evaluate(() => window.majveia.app.stage.child() === null));
check('with the binding curve up',
  await page.evaluate(() => !!window.majveia.app.stage.overlay()));

console.log(fails === 0 ? '\ndescending works everywhere' : `\n${fails} failed`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
