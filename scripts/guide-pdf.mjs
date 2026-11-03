#!/usr/bin/env node
/**
 * A GUIDE IN docs/guides AS A PDF (Payroll A–Z, 3 November 2026).
 *
 *   node scripts/guide-pdf.mjs docs/guides/payroll-a-z-en.md docs/guides/payroll-a-z-en.pdf
 *
 * Reads the same small Markdown the in-app Help reads (headings, numbered and
 * bulleted lines, paragraphs, bold, italics and `![…](img/…)` pictures, with
 * paths relative to the guide), lays it out as an A4 page and prints it with
 * Chromium. CHROME_PATH chooses the browser; otherwise Playwright's own.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/guide-pdf.mjs <guide.md> <guide.pdf>');
  process.exit(1);
}
const base = dirname(resolve(input));
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (text) =>
  escape(text)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

const html = [];
let list = null;
let paragraph = [];
const flushParagraph = () => {
  if (paragraph.length) html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  paragraph = [];
};
const flushList = () => {
  if (!list) return;
  html.push(`<${list.kind}>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${list.kind}>`);
  list = null;
};
for (const raw of readFileSync(input, 'utf8').split('\n')) {
  const line = raw.trimEnd();
  const picture = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line.trim());
  const numbered = /^\d+\.\s+(.*)$/.exec(line);
  const bullet = /^-\s+(.*)$/.exec(line);
  if (!line.trim()) {
    flushParagraph();
    continue;
  }
  if (picture) {
    flushParagraph();
    flushList();
    const src = pathToFileURL(resolve(base, picture[2])).href;
    const phone = /phone/.test(picture[2]) ? ' class="phone"' : '';
    html.push(`<figure><img${phone} src="${src}" alt="${escape(picture[1])}"></figure>`);
  } else if (line.startsWith('#')) {
    flushParagraph();
    flushList();
    const level = /^#+/.exec(line)[0].length;
    html.push(`<h${level}>${inline(line.slice(level).trim())}</h${level}>`);
  } else if (numbered || bullet) {
    flushParagraph();
    const kind = numbered ? 'ol' : 'ul';
    if (list && list.kind !== kind) flushList();
    if (!list) list = { kind, items: [] };
    list.items.push((numbered ?? bullet)[1]);
  } else if (list && /^\s+/.test(raw)) {
    list.items[list.items.length - 1] += ` ${line.trim()}`;
  } else {
    flushList();
    paragraph.push(line.trim());
  }
}
flushParagraph();
flushList();

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { font: 11pt/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #101828; margin: 0; }
  h1 { font-size: 22pt; margin: 0 0 8pt; }
  h2 { font-size: 15pt; margin: 18pt 0 6pt; border-bottom: 1px solid #e4e7ec; padding-bottom: 3pt; break-after: avoid; }
  h3 { font-size: 12pt; margin: 14pt 0 4pt; break-after: avoid; }
  p, li { margin: 0 0 5pt; }
  figure { margin: 4pt 0 8pt; break-inside: avoid; }
  img { display: block; max-width: 100%; max-height: 120mm; border: 1px solid #d0d5dd; border-radius: 4pt; }
  img.phone { max-height: 110mm; }
  code { font-size: 10pt; background: #f2f4f7; padding: 0 2pt; border-radius: 2pt; }
</style></head><body>${html.join('\n')}</body></html>`;

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const tab = await browser.newPage();
// From a file, so the pictures (file:// beside the guide) are allowed to load.
const folder = mkdtempSync(join(tmpdir(), 'guide-pdf-'));
writeFileSync(join(folder, 'guide.html'), page);
await tab.goto(pathToFileURL(join(folder, 'guide.html')).href, { waitUntil: 'load' });
await tab.pdf({
  path: output,
  format: 'A4',
  margin: { top: '16mm', bottom: '16mm', left: '16mm', right: '16mm' },
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: '<div style="font-size:8pt;color:#667085;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
});
await browser.close();
rmSync(folder, { recursive: true, force: true });
console.log(`${output} written.`);
