// Screenshot a lab scene at several simulated times.
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')];
}));
const times = (args.times ?? '0').split(',').map(Number);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: +(args.w ?? 900), height: +(args.h ?? 600) }, deviceScaleFactor: 1,
});
page.on('console', (m) => { if (m.type() !== 'warning') console.log(m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)));
await page.goto('http://localhost:4173/' + (args.page ?? 'lab.html') + '?' + (args.q ?? ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.lab?.ready === true, null, { timeout: 180000 });
await page.evaluate(() => document.getElementById('ui')?.classList.add('hidden')).catch((e) => console.log('hideui failed:', String(e).slice(0,200)));
let prev = 0;
for (const t of times) {
  try {
    await page.evaluate((dt) => window.lab.advance(dt), t - prev);
  } catch (e) { console.log('advance failed:', String(e).slice(0, 500)); }
  prev = t;
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${args.out ?? 'time'}-${t}.png` });
  console.log('shot t =', t);
}
await browser.close();
