import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.getByText(/LINK IN|접속 시작/i).first().click().catch(() => {});
await page.waitForTimeout(3500);

await page.mouse.down(); // continuous fire
let idx = 0;
// sweep right across the cluster, capture EVERY step
for (let i = 0; i < 30; i++) {
  await page.mouse.move(640 + 30, 360); // movementX ~ +30 each => turn right
  await page.waitForTimeout(70);
  await page.screenshot({ path: `dn-${String(idx++).padStart(2,'0')}.png` });
}
await page.mouse.up();

console.log('FRAMES:', idx);
console.log('ERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
await browser.close();
