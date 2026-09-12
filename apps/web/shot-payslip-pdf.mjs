/**
 * A PDF, AS A PNG — for the side-by-side against payslip.html.
 *
 * No PDF library in this container; Chromium's own viewer renders the file
 * and the page is screenshotted with the toolbar hidden and the page fitted.
 *
 *   node shot-payslip-pdf.mjs <in.pdf> <out.png>
 */
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const [input, output] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium', args: ['--headless=new'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: 2 });
await page.goto(`file://${resolve(input)}#toolbar=0&view=FitV`, { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.screenshot({ path: output });
await browser.close();
console.log(`  ${output}`);
