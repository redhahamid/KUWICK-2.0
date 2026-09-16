import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT ?? resolve(HERE, 'verify-out');
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const p = await b.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1.5 });
await p.emulateMedia({ media: 'print' });
await p.goto(`file://${resolve(HERE, '..', 'panduan.html')}`, { waitUntil: 'networkidle' });
// report broken images
const broken = await p.evaluate(() => [...document.images].filter(i => !i.complete || i.naturalWidth === 0).map(i => i.getAttribute('src')));
console.log('BROKEN IMAGES:', JSON.stringify(broken));
const h = await p.evaluate(() => document.documentElement.scrollHeight);
console.log('scrollHeight', h);
const PAGE = 1123;
for (const n of [0, 1, 3, 6, 10, 14, 18, 22]) {
  const y = n * PAGE;
  if (y >= h) continue;
  await p.evaluate((y) => window.scrollTo(0, y), y);
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${OUT}/verify-p${String(n).padStart(2,'0')}.png` });
}
await b.close();
