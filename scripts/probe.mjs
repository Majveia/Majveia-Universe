import { chromium } from 'playwright';
const args = process.argv.slice(2);
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 900, height: 620 } });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)));
await p.goto('http://localhost:4173/' + (args[1] ?? '?seed=ABELL&n=64'), { waitUntil: 'load' });
await p.waitForFunction(() => window.majveia?.ready === true, null, { timeout: 180000 });
await p.waitForTimeout(2000);
console.log(await p.evaluate(args[2] ?? '(() => "no expr")()'));
if (args[0]) { await p.waitForTimeout(2500); await p.screenshot({ path: args[0] }); }
await b.close();
