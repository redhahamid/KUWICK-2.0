/**
 * MOCKUP LEFT, RESULT RIGHT — the acceptance evidence §9.2 asks for.
 *
 * No image library in this container, so the browser does the compositing:
 * one HTML page, two images at their natural size, one screenshot of it.
 *
 *   node compose-side-by-side.mjs <mockup.png> <result.png> <out.png> "<title>"
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const [mockup, result, out, title = ''] = process.argv.slice(2);
const dataUri = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#dfe3e8;font:600 13px/1.4 Inter,system-ui,sans-serif;color:#0f1a1e}
  .wrap{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:20px}
  .col h2{margin:0 0 8px;font-size:13px;letter-spacing:.02em;color:#4b5a63}
  img{display:block;width:1440px;height:auto;border:1px solid #cbd1d8;background:#fff}
</style></head><body><div class="wrap">
  <div class="col"><h2>MOCKUP · ${title}</h2><img src="${dataUri(mockup)}"></div>
  <div class="col"><h2>RESULT · ${title}</h2><img src="${dataUri(result)}"></div>
</div></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 2960, height: 1100 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`  ${out}`);
