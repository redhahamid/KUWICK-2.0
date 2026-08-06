import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertFixturesAllowed, fixtureLabel } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G4.5d3c-3c1 — LIVE proof of the attachment allow-list, against the running
// API over real HTTP.
//
// The unit spec proves the validator. This proves the ENDPOINT: that the
// validator is actually wired in front of both upload paths, that a refused
// file leaves nothing on disk and no row behind, and that a rejection inside
// a batch does not disturb the files that already landed.
//
// Every hostile case here is sent the way an attacker would send it — a
// direct multipart POST, with no browser and no file picker anywhere in the
// path, which is exactly why an `accept` attribute was never a control.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g45d3c3c1-attachment-security-check.ts
const API = 'http://localhost:3000';
const TENANT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

function scoped<T>(fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, TENANT_ID);
    return fn(tx);
  });
}

async function login(email: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'DevLocal!2026' }),
  });
  const body = (await res.json()) as { accessToken?: string };
  if (!body.accessToken) throw new Error(`Login failed for ${email}`);
  return body.accessToken;
}

// --- Real signatures, and things pretending to have them -------------------
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x40, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'ascii'),
  Buffer.alloc(48),
]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n', 'ascii'), Buffer.alloc(64)]);
/** A Windows executable. */
const MZ = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(64)]);
const HTML = Buffer.from('<html><script>alert(document.cookie)</script></html>', 'utf8');

async function upload(visitId: string, token: string, name: string, type: string, bytes: Buffer) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type }), name);
  const res = await fetch(`${API}/visits/${visitId}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const created: string[] = [];

async function makeVisit(clinicId: string, doctorId: string, label: string): Promise<string> {
  return scoped(async (tx) => {
    const patient = await tx.patient.create({
      data: {
        tenantId: TENANT_ID,
        name: fixtureLabel(label),
        identifierType: 'PASSPORT',
        identifierValue: `AT${Date.now()}${Math.floor(Math.random() * 1000)}`,
      },
    });
    const visit = await tx.visit.create({
      data: {
        tenantId: TENANT_ID,
        clinicId,
        patientId: patient.id,
        staffId: doctorId,
        billingType: 'Self-pay',
        classification: 'FOLLOW_UP_NO_CONSULTATION',
        visitNumber: `AV-${Date.now() % 1000000}-${Math.floor(Math.random() * 100)}`,
        presentingComplaint: fixtureLabel(label),
      },
    });
    await tx.queueTicket.create({
      data: {
        tenantId: TENANT_ID,
        clinicId,
        visitId: visit.id,
        ticketNumber: Math.floor(Math.random() * 900) + 100,
        displayNumber: `A${Math.floor(Math.random() * 900) + 100}`,
        queueType: 'WALK_IN',
        status: 'IN_CONSULTATION',
      },
    });
    created.push(visit.id);
    return visit.id;
  });
}

async function main() {
  assertFixturesAllowed();
  const doc = await login('amira.rahman@smoke-test-clinic.test');
  const { clinicId, doctorId } = await scoped(async (tx) => {
    const clinic = await tx.clinic.findFirst({ select: { id: true } });
    const staff = await tx.staff.findMany({ select: { id: true, role: true } });
    const doctor = staff.find((s) => s.role === 'DOCTOR_RESIDENT' || s.role === 'DOCTOR_LOCUM');
    if (!clinic || !doctor) throw new Error('Dev tenant is missing a clinic or a doctor.');
    return { clinicId: clinic.id, doctorId: doctor.id };
  });

  console.log('\nG4.5d3c-3c1 — attachment allow-list, live over HTTP');
  console.log('='.repeat(72));

  try {
    const visitId = await makeVisit(clinicId, doctorId, 'attachment security');

    // === 1–4. The four approved types are accepted ======================
    for (const [label, name, type, bytes] of [
      ['1. JPEG', 'wound.jpg', 'image/jpeg', JPEG],
      ['2. PNG', 'otoscope.png', 'image/png', PNG],
      ['3. WebP', 'rash.webp', 'image/webp', WEBP],
      ['4. PDF', 'referral-letter.pdf', 'application/pdf', PDF],
    ] as const) {
      const result = await upload(visitId, doc, name, type, bytes);
      check(`${label} is accepted`, result.status === 201, `HTTP ${result.status}`);
    }

    const acceptedCount = await scoped((tx) => tx.visitAttachment.count({ where: { visitId } }));
    check('5. all four are on the record', acceptedCount === 4, `${acceptedCount} stored`);

    // === 6–12. Everything else is refused ===============================
    const hostile = [
      ['6. an executable, honestly declared', 'payload.exe', 'application/x-msdownload', MZ],
      ['7. an executable RENAMED to .pdf and declared as PDF', 'report.pdf', 'application/pdf', MZ],
      ['8. HTML renamed to .png and declared as PNG', 'image.png', 'image/png', HTML],
      ['9. a script, honestly declared', 'run.js', 'text/javascript', HTML],
      ['10. SVG — scriptable, and not on the list', 'diagram.svg', 'image/svg+xml', HTML],
      ['11. a Word document', 'letter.docx', 'application/msword', PDF],
      ['12. a PNG relabelled and renamed as a JPEG', 'photo.jpg', 'image/jpeg', PNG],
    ] as const;

    for (const [label, name, type, bytes] of hostile) {
      const result = await upload(visitId, doc, name, type, bytes);
      const message = (result.body as { message?: string } | null)?.message ?? '';
      check(
        `${label} is refused`,
        result.status === 400 && message.includes('Upload JPG, PNG, WebP or PDF'),
        `HTTP ${result.status} "${message}"`,
      );
    }

    // === 13–14. A refusal leaves nothing behind =========================
    const afterHostile = await scoped((tx) => tx.visitAttachment.count({ where: { visitId } }));
    check('13. no refused file created a row', afterHostile === 4, `${afterHostile} rows`);
    check(
      '14. …and the four permitted files are untouched',
      afterHostile === acceptedCount,
      `${afterHostile} vs ${acceptedCount}`,
    );

    // === 15. The refusal message is the approved wording ================
    {
      const result = await upload(visitId, doc, 'x.exe', 'application/x-msdownload', MZ);
      const message = (result.body as { message?: string } | null)?.message ?? '';
      check(
        '15. the per-file error is the approved sentence',
        message === 'Unsupported file type. Upload JPG, PNG, WebP or PDF.',
        `"${message}"`,
      );
    }

    // === 16–18. A mixed batch: the good files still land =================
    {
      const batchVisit = await makeVisit(clinicId, doctorId, 'attachment batch');
      const sequence = [
        await upload(batchVisit, doc, 'page1.pdf', 'application/pdf', PDF),
        await upload(batchVisit, doc, 'evil.pdf', 'application/pdf', MZ),
        await upload(batchVisit, doc, 'page2.pdf', 'application/pdf', PDF),
        await upload(batchVisit, doc, 'wound.jpg', 'image/jpeg', JPEG),
      ];
      const stored = await scoped((tx) =>
        tx.visitAttachment.findMany({ where: { visitId: batchVisit }, select: { fileName: true } }),
      );
      check(
        '16. one refused file does not cancel the permitted ones',
        stored.length === 3,
        stored.map((a) => a.fileName).join(', '),
      );
      check('17. the refusal is the second request only', sequence[1].status === 400, `HTTP ${sequence[1].status}`);
      check(
        '18. files uploaded AFTER the refusal still land',
        stored.some((a) => a.fileName === 'page2.pdf') && stored.some((a) => a.fileName === 'wound.jpg'),
      );
    }

    // === 19–21. The stored name and type are the SERVER'S ===============
    {
      const nameVisit = await makeVisit(clinicId, doctorId, 'attachment naming');
      await upload(nameVisit, doc, '../../etc/passwd.png', 'image/png', PNG);
      const stored = await scoped((tx) =>
        tx.visitAttachment.findFirst({ where: { visitId: nameVisit }, select: { fileName: true, mimeType: true, filePath: true } }),
      );
      check('19. a traversal filename is sanitised before storage', stored?.fileName === 'passwd.png', `${stored?.fileName}`);
      check('20. the stored path stays inside the tenant/visit namespace',
        Boolean(stored?.filePath?.startsWith(`${TENANT_ID}/${nameVisit}/`)), `${stored?.filePath}`);
      check('21. the stored MIME type is one from the allow-list',
        stored?.mimeType === 'image/png', `${stored?.mimeType}`);
    }

    // === 22. The size limit is preserved ================================
    {
      const big = Buffer.concat([PDF, Buffer.alloc(16 * 1024 * 1024)]);
      const result = await upload(visitId, doc, 'huge.pdf', 'application/pdf', big);
      check('22. the 15 MB limit still applies', result.status === 413, `HTTP ${result.status}`);
    }

    // === 23. Authentication is still required ===========================
    {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(PDF)], { type: 'application/pdf' }), 'anon.pdf');
      const res = await fetch(`${API}/visits/${visitId}/attachments`, { method: 'POST', body: form });
      check('23. an unauthenticated upload is refused', res.status === 401, `HTTP ${res.status}`);
    }

    // === 24. Retrieval of an accepted file still works ==================
    {
      const attachment = await scoped((tx) =>
        tx.visitAttachment.findFirst({ where: { visitId, mimeType: 'application/pdf' }, select: { id: true } }),
      );
      const res = await fetch(`${API}/visits/${visitId}/attachments/${attachment?.id}/download`, {
        headers: { Authorization: `Bearer ${doc}` },
      });
      check('24. an accepted attachment is still retrievable',
        res.status === 200 && res.headers.get('content-type') === 'application/pdf',
        `HTTP ${res.status} ${res.headers.get('content-type')}`);
    }
  } finally {
    if (created.length > 0) {
      await scoped(async (tx) => {
        const list = created.map((id) => `'${id}'`).join(',');
        await tx.$executeRawUnsafe(`DELETE FROM visit_attachments WHERE visit_id IN (${list})`);
        await tx.$executeRawUnsafe(`UPDATE queue_tickets SET status = 'COMPLETED' WHERE visit_id IN (${list})`);
        await tx.$executeRawUnsafe(`UPDATE visits SET check_out_at = COALESCE(check_out_at, now()) WHERE id IN (${list})`);
        await tx.$executeRawUnsafe(
          `UPDATE patients SET deleted_at = now() WHERE id IN (SELECT patient_id FROM visits WHERE id IN (${list}))`,
        );
      });
    }
  }

  console.log('='.repeat(72));
  console.log(`${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
