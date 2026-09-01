import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
const seen = new Set();
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('THREE') || t.includes('ERROR:') || t.includes('gl.') || m.type()==='error') {
    if (!seen.has(t.slice(0,200))) { seen.add(t.slice(0,200)); console.log(t.slice(0, 3000)); }
  }
});
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:4173/' + process.argv[2], { waitUntil: 'load' });
await page.waitForTimeout(8000);
await browser.close();
