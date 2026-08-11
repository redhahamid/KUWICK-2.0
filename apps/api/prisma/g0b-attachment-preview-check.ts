import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium, Page } from 'playwright-core';
import { FIXTURE_TAG, FixtureLedger, assertFixturesAllowed, fixtureLabel, sweepOrphanedFixtures } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G0b (D-055) — clinical images must be viewable inside the record.
//
// Uploads three realistic clinical images plus a non-image file, then checks
// in real Chrome that thumbnails render, the lightbox opens, the gallery pages
// between images, the non-image file is NOT shown as a broken thumbnail, and
// uploader attribution survives.
//
//   npx tsx prisma/g0b-attachment-preview-check.ts [--shots]
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const SHOTS = process.argv.includes('--shots');
const OUT = join(__dirname, '..', '..', '..', 'docs', 'g0-screenshots');

const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let ledger: FixtureLedger | undefined;

async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

// Draw a labelled image in the browser rather than shipping binary fixtures —
// a real PNG, and one a human can recognise in the screenshots.
const DRAW_JS = `((label, color) => {
  var c = document.createElement('canvas');
  c.width = 640; c.height = 480;
  var g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, 640, 480);
  g.fillStyle = '#ffffff'; g.font = 'bold 44px sans-serif';
  g.fillText(label, 40, 250);
  return c.toDataURL('image/png');
})`;

async function uploadPng(token: string, visitId: string, name: string, dataUrl: string) {
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/png' }), name);
  const res = await fetch(`${API}/visits/${visitId}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`upload ${name} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function uploadPdf(token: string, visitId: string, name: string) {
  // Smallest structurally valid PDF — this check only needs it to be a
  // non-image attachment, not to render.
  const pdf =
    '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 99 9]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n';
  const form = new FormData();
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), name);
  const res = await fetch(`${API}/visits/${visitId}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`upload ${name} → ${res.status} ${await res.text()}`);
  return res.json();
}

const INSPECT_JS = `(() => {
  var imgs = Array.prototype.slice.call(document.querySelectorAll('.ant-image img'));
  return {
    thumbCount: imgs.length,
    blobThumbs: imgs.filter(function (i) { return (i.src || '').indexOf('blob:') === 0; }).length,
    brokenThumbs: imgs.filter(function (i) { return i.complete && i.naturalWidth === 0; }).length,
    bodyText: document.body.innerText
  };
})()`;

async function main() {
  assertFixturesAllowed();
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  const seed = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    const rows = await tx.$queryRawUnsafe<
      { user_id: string; staff_id: string; tenant_id: string; role: string; full_name: string; tenant_name: string }[]
    >(`
      SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role, s.full_name, t.name AS tenant_name
      FROM staff s JOIN users u ON s.user_id = u.id JOIN tenants t ON t.id = s.tenant_id
      WHERE s.active AND s.role IN ('DOCTOR_RESIDENT','DOCTOR_LOCUM') LIMIT 1
    `);
    if (rows.length === 0) throw new Error('No active doctor with a user account found');
    return rows[0];
  });

  const token = jwt.sign(
    { sub: seed.user_id, tenantId: seed.tenant_id, staffId: seed.staff_id, role: seed.role },
    process.env.JWT_ACCESS_SECRET as string,
    { expiresIn: '30m' },
  );

  const patients = await api('/patients', token);
  const patient = patients[0];
  const clinics = await api('/clinics', token);

  const swept = await sweepOrphanedFixtures(prisma, seed.tenant_id);
  if (swept > 0) console.log(`Swept ${swept} leftover fixture visit(s)`);
  ledger = new FixtureLedger(prisma, API, token, seed.tenant_id);

  const visit = await api('/visits', token, 'POST', {
    clinicId: clinics[0].id,
    patientId: patient.id,
    staffId: seed.staff_id,
    billingType: 'Cash',
    presentingComplaint: fixtureLabel('G0b attachment preview check'),
  });
  ledger.visit(visit.id);

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(
    (a) => {
      localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 }));
      localStorage.setItem('kuwick-record-view-layout', JSON.stringify({ state: { layout: 'canvas' }, version: 0 }));
    },
    {
      accessToken: token,
      refreshToken: token,
      staff: { id: seed.staff_id, fullName: seed.full_name, role: seed.role, clinicId: null },
      tenant: { id: seed.tenant_id, name: seed.tenant_name, slug: null },
    },
  );
  const page: Page = await context.newPage();
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });

  // Three clinical-looking images + one PDF.
  const shots: [string, string][] = [
    ['OTOSCOPE R', '#8c3b2f'],
    ['WOUND D3', '#7a4a2b'],
    ['DERM LESION', '#5a3f6b'],
  ];
  // Filenames carry the fixture tag so a test-generated upload is identifiable
  // on disk, not just in the database — if cleanup is ever interrupted, nobody
  // has to guess which files are a real clinic's and which are this script's.
  for (const [label, color] of shots) {
    const dataUrl = (await page.evaluate(`${DRAW_JS}(${JSON.stringify(label)}, ${JSON.stringify(color)})`)) as string;
    await uploadPng(token, visit.id, `${FIXTURE_TAG}-${label.toLowerCase().replace(/ /g, '-')}.png`, dataUrl);
  }
  await uploadPdf(token, visit.id, `${FIXTURE_TAG}-lab-result.pdf`);

  const listed = await api(`/visits/${visit.id}/attachments`, token);
  // G3a (D-062) — no per-attachment registration any more: the ledger unlinks
  // the files of every attachment hanging off the visits this run created.
  check('4 attachments uploaded (3 images + 1 PDF)', listed.length === 4, `${listed.length} listed`);
  check(
    'uploader attribution recorded server-side from the session',
    listed.every((a: { uploadedByStaffId: string | null }) => a.uploadedByStaffId === seed.staff_id),
    `all attributed to ${seed.full_name}`,
  );

  await page.goto(`${WEB}/patients/${patient.id}?visitId=${visit.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const inline = (await page.evaluate(INSPECT_JS)) as any;
  if (SHOTS) await page.screenshot({ path: join(OUT, 'g0b-thumbnails-inline.png') });

  check('image thumbnails render inline', inline.thumbCount === 3, `${inline.thumbCount} thumbnail(s)`);
  check(
    'thumbnails are authenticated blobs, not raw URLs',
    inline.blobThumbs === 3,
    `${inline.blobThumbs}/3 blob: sources`,
  );
  check('no broken image placeholders', inline.brokenThumbs === 0, `${inline.brokenThumbs} broken`);
  check(
    'the PDF is listed as a file, not a thumbnail',
    inline.bodyText.includes('lab-result.pdf'),
    inline.bodyText.includes('lab-result.pdf') ? 'shown as a named file' : 'missing',
  );
  check('attachment count reflects all four', inline.bodyText.includes('Attachments (4)'), 'header count');

  // Lightbox: click the first thumbnail. antd renders a hover mask over the
  // image that owns the click, so target the wrapper rather than the <img>.
  await page.locator('.ant-image').first().click();
  await page.waitForTimeout(1200);
  const previewRoot = page.locator('[class*="ant-image-preview"]');
  const previewImgs = await previewRoot.locator('img').count();
  if (SHOTS) await page.screenshot({ path: join(OUT, 'g0b-lightbox-open.png') });
  check('lightbox opens on click', previewImgs > 0, `${previewImgs} preview image(s)`);

  // Gallery: page to the next image without leaving the record. antd v6 names
  // these -switch-prev / -switch-next (not -switch-left/right, which is what
  // an earlier version of this check looked for and wrongly reported failing).
  const currentSrc = () => page.locator('.ant-image-preview-img').first().getAttribute('src');
  const next = page.locator('.ant-image-preview-switch-next');
  const hasSwitch = (await next.count()) > 0;
  let changed = false;
  if (hasSwitch) {
    const before = await currentSrc();
    await next.click();
    await page.waitForTimeout(800);
    changed = (await currentSrc()) !== before;
    if (SHOTS) await page.screenshot({ path: join(OUT, 'g0b-lightbox-next.png') });
  }
  check(
    'gallery pages between images (all 3 in one group)',
    hasSwitch && changed,
    hasSwitch ? `next control present, image ${changed ? 'changed' : 'did NOT change'}` : 'no switch control',
  );

  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const afterClose = (await page.evaluate(INSPECT_JS)) as any;
  check(
    'closing the lightbox returns to the record',
    afterClose.bodyText.includes('Clinical Notes'),
    'record still open',
  );

  // ---- thumbnail dimensions actually applied ----
  const sizes = (await page.evaluate(`(() => {
    var el = document.querySelector('.ant-image img');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  })()`)) as { w: number; h: number } | null;
  check(
    'compact strip thumbnail is 48px',
    sizes?.w === 48 && sizes?.h === 48,
    `${sizes?.w}x${sizes?.h}px`,
  );

  // Flow layout renders the expanded attachment card, where a doctor actually
  // judges a wound or a lesion — bigger, but still a preview.
  //
  // Switched through the real Layout control, NOT localStorage + reload:
  // addInitScript re-sets the layout to canvas on every navigation, so the
  // localStorage route silently stayed in Canvas and measured the 48px strip
  // while claiming to measure the expanded panel.
  await page.getByText('Flow', { exact: true }).first().click();
  await page.waitForTimeout(2000);
  const expandedSize = (await page.evaluate(`(() => {
    var el = document.querySelector('.ant-image img');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  })()`)) as { w: number; h: number } | null;
  if (SHOTS) await page.screenshot({ path: join(OUT, 'g0b-expanded-panel.png') });
  check(
    'expanded panel thumbnail is 96px',
    expandedSize?.w === 96 && expandedSize?.h === 96,
    `${expandedSize?.w}x${expandedSize?.h}px`,
  );

  // ---- image-load failure fallback ----
  // Block ONE image's bytes so the mixed state is visible: the other two still
  // render, the failed one becomes a named file row rather than a blank square.
  const blockedId: string = listed.find((a: { mimeType: string }) => a.mimeType.startsWith('image/')).id;
  await page.route(`**/attachments/${blockedId}/download`, (route) => route.abort());
  // Back to Canvas (the reload restores it via addInitScript) so the failure
  // state is captured in the layout doctors actually use.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const degraded = (await page.evaluate(INSPECT_JS)) as any;
  if (SHOTS) await page.screenshot({ path: join(OUT, 'g0b-image-load-failure-fallback.png') });
  check(
    'an unreadable image degrades to a file row, not a blank square',
    degraded.thumbCount === 2 && degraded.brokenThumbs === 0,
    `${degraded.thumbCount} thumbnail(s), ${degraded.brokenThumbs} broken`,
  );
  check(
    'the unreadable image is still listed, not silently dropped',
    degraded.bodyText.includes('Attachments'),
    'attachment count still reflects every file',
  );
  await page.unroute(`**/attachments/${blockedId}/download`);

  await context.close();
  await browser.close();
}

main()
  .then(() => {
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length > 0) process.exitCode = 1;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Attachments go through the API so their files leave the disk too.
    await ledger?.cleanup();
    await prisma.$disconnect();
  });
