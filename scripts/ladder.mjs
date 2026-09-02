// Descend the scale ladder, screenshotting each level, and report any errors.
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')];
}));
const out = args.out ?? 'ladder';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: +(args.w ?? 1000), height: +(args.h ?? 640) }, deviceScaleFactor: 1,
});
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 400)));
await page.goto('http://localhost:4173/?' + (args.q ?? ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 240000 });
await page.waitForTimeout(2500);
const names = ['cosmos', 'cluster', 'galaxy', 'system', 'world'];
for (let i = 0; i < 5; i++) {
  await page.screenshot({ path: `${out}-${i}-${names[i]}.png` });
  const info = await page.evaluate(() => {
    const s = window.majveia.app.stage ?? null;
    return s ? { id: s.id, title: s.title, sub: s.subtitle } : null;
  }).catch(() => null);
  console.log(i, names[i], JSON.stringify(info));
  if (i === 4) break;
  await page.evaluate(() => window.majveia.descend());
  await page.waitForTimeout(600);
  await page.waitForFunction(() => window.majveia.travelling === false, null, { timeout: 120000 })
    .catch(() => console.log('  (transition timed out)'));
  await page.waitForTimeout(+(args.wait ?? 3000));
}
console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 12).join('\n') : 'no console errors');
await browser.close();
