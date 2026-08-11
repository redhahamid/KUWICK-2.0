import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { FixtureLedger, assertFixturesAllowed, fixtureLabel, sweepOrphanedFixtures } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G3a (D-062) — clinical documents and attachments are voided/removed with an
// audit trail, never destroyed. This exercises the REAL database, the REAL
// HTTP API and the REAL uploads directory, covering the 24 required checks.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g3a-document-attachment-integrity-check.ts
const API = 'http://localhost:3000';
const UPLOADS_ROOT = process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let ledger: FixtureLedger | undefined;

const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await call(path, token, method, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

async function upload(path: string, token: string, fileName: string, bytes: Buffer, mime: string) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), fileName);
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const text = await res.text();
  if (res.status >= 400) throw new Error(`POST ${path} → ${res.status} ${text}`);
  return JSON.parse(text);
}

// A one-pixel PNG — real image bytes, so the API's own MIME handling applies.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function fileExists(relativePath: string): Promise<boolean> {
  return access(join(UPLOADS_ROOT, relativePath)).then(
    () => true,
    () => false,
  );
}

/**
 * Count across every tenant, one tenant at a time.
 *
 * D-048 trap, hit again here: `app.bypass_tenant_scope` does NOT cover
 * documents, visit_attachments or attachments. Reading them with only the
 * bypass GUC set returns ZERO ROWS AND NO ERROR — a full-table audit that
 * silently reports "0 rows, all fine" over real clinical data. The only way
 * these tables answer honestly is with `app.tenant_id` set on the same
 * connection, so the sum is built per tenant and the tenant list itself is
 * read under the bypass (which does cover `tenants`).
 */
async function countPerTenant(sql: (alias: string) => string) {
  const tenants = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM tenants`);
  });
  if (tenants.length === 0) throw new Error('No tenants readable — the audit query itself is being filtered.');

  const totals = new Map<string, { n: number; active: number; attributed: number }>();
  for (const tenant of tenants) {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.$queryRawUnsafe<{ t: string; n: number; active: number; attributed: number }[]>(sql(tenant.id));
    });
    for (const row of rows) {
      const acc = totals.get(row.t) ?? { n: 0, active: 0, attributed: 0 };
      acc.n += row.n;
      acc.active += row.active;
      acc.attributed += row.attributed;
      totals.set(row.t, acc);
    }
  }
  return totals;
}

const STATUS_COUNTS = () => `
  SELECT 'documents' AS t, count(*)::int AS n,
         count(*) FILTER (WHERE record_status = 'ACTIVE')::int AS active,
         count(*) FILTER (WHERE voided_by_staff_id IS NOT NULL OR void_reason IS NOT NULL)::int AS attributed
    FROM documents
  UNION ALL
  SELECT 'visit_attachments', count(*)::int,
         count(*) FILTER (WHERE record_status = 'ACTIVE')::int,
         count(*) FILTER (WHERE removed_by_staff_id IS NOT NULL OR removal_reason IS NOT NULL)::int
    FROM visit_attachments
  UNION ALL
  SELECT 'attachments', count(*)::int,
         count(*) FILTER (WHERE record_status = 'ACTIVE')::int,
         count(*) FILTER (WHERE removed_by_staff_id IS NOT NULL OR removal_reason IS NOT NULL)::int
    FROM attachments
`;

// The stored path is deliberately not exposed by the API — read it straight
// from the database so "the file is still there" is checked against disk.
async function storedPath(table: 'visit_attachments' | 'attachments', id: string, tenantId: string) {
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return tx.$queryRawUnsafe<{ file_path: string }[]>(`SELECT file_path FROM ${table} WHERE id = '${id}'`);
  });
  return rows[0]?.file_path;
}

async function main() {
  assertFixturesAllowed();

  const seeds = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<
      { user_id: string; staff_id: string; tenant_id: string; role: string; full_name: string }[]
    >(`
      SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role, s.full_name
      FROM staff s JOIN users u ON s.user_id = u.id
      WHERE s.active AND s.role IN ('DOCTOR_RESIDENT','DOCTOR_LOCUM')
    `);
  });
  const seed = seeds[0];

  // A real non-clinical actor for the authorisation checks — front desk and a
  // non-clinical owner-admin, taken from the database rather than invented.
  const nonClinical = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<{ user_id: string; staff_id: string; tenant_id: string; role: string }[]>(`
      SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role
      FROM staff s JOIN users u ON s.user_id = u.id
      WHERE s.active AND s.tenant_id = '${seed.tenant_id}'
        AND s.role IN ('FRONT_DESK_CLINICAL_STAFF','OWNER_ADMIN')
        AND (s.professional_type IS NULL OR s.professional_active = false)
    `);
  });

  const tokenFor = (s: { user_id: string; tenant_id: string; staff_id: string; role: string }) =>
    jwt.sign(
      { sub: s.user_id, tenantId: s.tenant_id, staffId: s.staff_id, role: s.role },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: '30m' },
    );
  const token = tokenFor(seed);

  const swept = await sweepOrphanedFixtures(prisma, seed.tenant_id);
  if (swept > 0) console.log(`Swept ${swept} leftover fixture visit(s)`);
  ledger = new FixtureLedger(prisma, API, token, seed.tenant_id);

  // ---------------------------------------------------------------- migration
  // 1, 2, 11, 19 — every pre-existing row survived and is ACTIVE.
  const migrated = await countPerTenant(STATUS_COUNTS);
  for (const [table, row] of migrated) {
    check(
      `existing ${table} migrated as ACTIVE`,
      row.n > 0 && row.active === row.n,
      `${row.active}/${row.n} ACTIVE across all tenants`,
    );
    check(
      `no ${table} row was given fabricated removal attribution`,
      row.attributed === 0,
      `${row.attributed} with invented void/removal data`,
    );
  }
  const totalsBefore = new Map([...migrated].map(([t, r]) => [t, r.n]));

  // ------------------------------------------------------------------ fixture
  const patients = await api('/patients', token);
  const clinics = await api('/clinics', token);
  const visit = await api('/visits', token, 'POST', {
    clinicId: clinics[0].id,
    patientId: patients[0].id,
    staffId: seed.staff_id,
    billingType: 'Cash',
    presentingComplaint: fixtureLabel('G3a document and attachment integrity'),
  });
  ledger.visit(visit.id);

  // ==================================================================== A. DOCUMENTS
  const doc = await api('/documents', token, 'POST', {
    visitId: visit.id,
    type: 'MC',
    content: 'Unfit for duty for two days. Rest advised.',
    startDate: '2026-08-02',
    endDate: '2026-08-03',
  });
  await api(`/documents/${doc.id}/sign`, token, 'PATCH', { staffId: seed.staff_id });
  const signedDoc = (await api(`/documents?visitId=${visit.id}`, token)).find((d: { id: string }) => d.id === doc.id);

  // 3 — the hard-delete route is gone.
  const docDelete = await call(`/documents/${doc.id}`, token, 'DELETE');
  check('DELETE /documents/:id is unreachable', docDelete.status === 404, `HTTP ${docDelete.status}`);

  // 4 — reason mandatory.
  const noReason = await call(`/documents/${doc.id}/void`, token, 'PATCH', { reason: '' });
  check('voiding a document requires a reason', noReason.status === 400, `HTTP ${noReason.status}`);

  // 5 — actor is server-derived, and a supplied one is rejected outright.
  const spoofVoid = await call(`/documents/${doc.id}/void`, token, 'PATCH', {
    reason: 'Issued in error',
    voidedByStaffId: 'attacker-staff-id',
  });
  check('browser-supplied void actor is rejected', spoofVoid.status === 400, `HTTP ${spoofVoid.status}`);

  // 10 — non-clinical staff denied. Checked BEFORE the real void, so a refusal
  // cannot be confused with "already voided".
  for (const actor of nonClinical) {
    const denied = await call(`/documents/${doc.id}/void`, tokenFor(actor), 'PATCH', { reason: 'not my place' });
    check(
      `a ${actor.role} cannot void a clinical document`,
      denied.status === 403,
      `HTTP ${denied.status}`,
    );
  }
  if (nonClinical.length === 0) console.log('SKIP  non-clinical denial — no such staff in this database');

  const voided = await api(`/documents/${doc.id}/void`, token, 'PATCH', { reason: 'Wrong dates entered' });

  // 6 — content, issuer and signature untouched.
  check(
    'voided document keeps its content, issuer and signature',
    voided.content === signedDoc.content &&
      voided.issuedByStaffId === signedDoc.issuedByStaffId &&
      voided.signedByStaffId === signedDoc.signedByStaffId &&
      voided.signedAt === signedDoc.signedAt,
    `signed ${voided.signedAt} by ${voided.signedByStaffId?.slice(0, 8)}`,
  );
  check(
    'void records actor, time and reason from the session',
    voided.voidedByStaffId === seed.staff_id &&
      voided.voidedByNameSnapshot === seed.full_name &&
      Boolean(voided.voidedAt) &&
      voided.voidReason === 'Wrong dates entered',
    `voided by ${voided.voidedByNameSnapshot}`,
  );

  // 7 — gone from the active list.
  const activeDocs = await api(`/documents?visitId=${visit.id}`, token);
  check(
    'voided document leaves the active list',
    !activeDocs.some((d: { id: string }) => d.id === doc.id),
    `${activeDocs.length} active document(s)`,
  );

  // 8 — still in history, flagged.
  const docHistory = await api(`/documents/history?visitId=${visit.id}`, token);
  const inHistory = docHistory.find((d: { id: string }) => d.id === doc.id);
  check(
    'voided document remains in authorised history, clearly flagged',
    inHistory?.recordStatus === 'VOIDED' && inHistory.content === signedDoc.content,
    `recordStatus=${inHistory?.recordStatus}`,
  );

  // 9 — repeated and stale.
  const revoid = await call(`/documents/${doc.id}/void`, token, 'PATCH', { reason: 'again' });
  check('re-voiding a document returns 409', revoid.status === 409, `HTTP ${revoid.status}`);

  const doc2 = await api('/documents', token, 'POST', {
    visitId: visit.id,
    type: 'MEMO',
    content: 'Clinical memo for the stale-version check.',
  });
  const staleVoid = await call(`/documents/${doc2.id}/void`, token, 'PATCH', {
    reason: 'stale version check',
    expectedVersion: 999,
  });
  check('a stale expectedVersion on void returns 409', staleVoid.status === 409, `HTTP ${staleVoid.status}`);

  // ======================================================== B. VISIT ATTACHMENTS
  const img = await upload(`/visits/${visit.id}/attachments`, token, 'otoscope-right.png', PNG, 'image/png');
  const imgPath = await storedPath('visit_attachments', img.id, seed.tenant_id);
  check('uploaded clinical image is on disk before removal', await fileExists(imgPath!), imgPath!);

  const vaDelete = await call(`/visits/${visit.id}/attachments/${img.id}`, token, 'DELETE');
  check(
    'DELETE /visits/:id/attachments/:id is unreachable',
    vaDelete.status === 404,
    `HTTP ${vaDelete.status}`,
  );

  const vaNoReason = await call(`/visits/${visit.id}/attachments/${img.id}/removal`, token, 'PATCH', { reason: '' });
  check('removing a clinical image requires a reason', vaNoReason.status === 400, `HTTP ${vaNoReason.status}`);

  const vaSpoof = await call(`/visits/${visit.id}/attachments/${img.id}/removal`, token, 'PATCH', {
    reason: 'Wrong visit',
    removedByStaffId: 'attacker-staff-id',
  });
  check('browser-supplied remover identity is rejected', vaSpoof.status === 400, `HTTP ${vaSpoof.status}`);

  // 18 — cross-tenant. A token scoped to a different tenant is the shape of a
  // forged or misrouted token; RLS must hide the row from it entirely.
  const otherTenant = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    const rows = await tx.$queryRawUnsafe<{ id: string; name: string }[]>(
      `SELECT id, name FROM tenants WHERE id <> '${seed.tenant_id}' LIMIT 1`,
    );
    return rows[0] ?? null;
  });
  if (otherTenant) {
    const foreign = jwt.sign(
      { sub: seed.user_id, tenantId: otherTenant.id, staffId: seed.staff_id, role: seed.role },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: '30m' },
    );
    const crossList = await call(`/visits/${visit.id}/attachments`, foreign);
    check(
      `a token scoped to "${otherTenant.name}" sees none of this visit's attachments`,
      Array.isArray(crossList.body) ? crossList.body.length === 0 : crossList.status >= 400,
      `HTTP ${crossList.status}, ${Array.isArray(crossList.body) ? crossList.body.length : '-'} row(s)`,
    );
    const crossRemove = await call(`/visits/${visit.id}/attachments/${img.id}/removal`, foreign, 'PATCH', {
      reason: 'cross-tenant attempt',
    });
    check('a cross-tenant token cannot remove this attachment', crossRemove.status >= 400, `HTTP ${crossRemove.status}`);
    const crossHistory = await call(`/visits/${visit.id}/attachments/history`, foreign);
    check(
      'a cross-tenant token cannot read the removal history either',
      Array.isArray(crossHistory.body) ? crossHistory.body.length === 0 : crossHistory.status >= 400,
      `HTTP ${crossHistory.status}`,
    );
  } else {
    console.log('SKIP  cross-tenant — only one tenant exists in this database');
  }

  for (const actor of nonClinical) {
    const denied = await call(`/visits/${visit.id}/attachments/${img.id}/removal`, tokenFor(actor), 'PATCH', {
      reason: 'not my place',
    });
    check(`a ${actor.role} cannot remove a clinical image`, denied.status === 403, `HTTP ${denied.status}`);
  }

  const removedImg = await api(`/visits/${visit.id}/attachments/${img.id}/removal`, token, 'PATCH', {
    reason: 'Photographed on the wrong patient',
  });
  check(
    'removal records actor, time and reason from the session',
    removedImg.removedByStaffId === seed.staff_id &&
      removedImg.removedByNameSnapshot === seed.full_name &&
      Boolean(removedImg.removedAt) &&
      removedImg.removalReason === 'Photographed on the wrong patient',
    `removed by ${removedImg.removedByNameSnapshot}`,
  );

  // 17 — the file itself is untouched. This is the whole point of G3a.
  check('the clinical image file is NOT deleted from disk', await fileExists(imgPath!), imgPath!);

  // 14 — gone from the active gallery.
  const activeAtt = await api(`/visits/${visit.id}/attachments`, token);
  check(
    'removed image leaves the active gallery',
    !activeAtt.some((a: { id: string }) => a.id === img.id),
    `${activeAtt.length} active attachment(s)`,
  );

  // 13 + history metadata retention.
  const attHistory = await api(`/visits/${visit.id}/attachments/history`, token);
  const histImg = attHistory.find((a: { id: string }) => a.id === img.id);
  check(
    'history retains filename, MIME type, uploader and upload time',
    histImg?.fileName === img.fileName &&
      histImg.mimeType === img.mimeType &&
      histImg.uploadedByStaffId === img.uploadedByStaffId &&
      histImg.createdAt === img.createdAt,
    `${histImg?.fileName} (${histImg?.mimeType})`,
  );
  const histDownload = await fetch(`${API}/visits/${visit.id}/attachments/${img.id}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const downloadedBytes = Buffer.from(await histDownload.arrayBuffer());
  check(
    'the original file is still retrievable, byte-for-byte',
    histDownload.status === 200 && downloadedBytes.equals(PNG),
    `HTTP ${histDownload.status}, ${downloadedBytes.length} bytes`,
  );

  const vaReremove = await call(`/visits/${visit.id}/attachments/${img.id}/removal`, token, 'PATCH', {
    reason: 'again',
  });
  check('re-removing an image returns 409', vaReremove.status === 409, `HTTP ${vaReremove.status}`);

  const img2 = await upload(`/visits/${visit.id}/attachments`, token, 'wound-day3.png', PNG, 'image/png');
  const vaStale = await call(`/visits/${visit.id}/attachments/${img2.id}/removal`, token, 'PATCH', {
    reason: 'stale version check',
    expectedVersion: 999,
  });
  check('a stale expectedVersion on removal returns 409', vaStale.status === 409, `HTTP ${vaStale.status}`);

  // ======================================================== C. ORDER ATTACHMENTS
  const services = await api('/services', token);
  const taskService = services.find((s: { orderType: string }) => s.orderType === 'TASK_ORDER');
  const order = await api('/order-services', token, 'POST', {
    visitId: visit.id,
    serviceCatalogId: taskService.id,
    instruction: fixtureLabel('G3a result retention'),
  });
  await api(`/order-services/${order.id}/start`, token, 'PATCH');
  await api(`/order-services/${order.id}/complete`, token, 'PATCH', { result: 'Hb 13.5 g/dL' });

  const res1 = await upload(`/order-services/${order.id}/attachments`, token, 'fbc-report.png', PNG, 'image/png');
  const resPath = await storedPath('attachments', res1.id, seed.tenant_id);

  const oaDelete = await call(`/order-services/${order.id}/attachments/${res1.id}`, token, 'DELETE');
  check(
    'DELETE /order-services/:id/attachments/:id is unreachable',
    oaDelete.status === 404,
    `HTTP ${oaDelete.status}`,
  );

  for (const actor of nonClinical) {
    const denied = await call(`/order-services/${order.id}/attachments/${res1.id}/removal`, tokenFor(actor), 'PATCH', {
      reason: 'not my place',
    });
    check(`a ${actor.role} cannot remove a finalised result`, denied.status === 403, `HTTP ${denied.status}`);
  }

  const orderBefore = await api(`/order-services/${order.id}`, token);
  const removedRes = await api(`/order-services/${order.id}/attachments/${res1.id}/removal`, token, 'PATCH', {
    reason: 'Result belongs to another patient',
  });

  // 20
  const activeResults = await api(`/order-services/${order.id}/attachments`, token);
  check(
    'removed result leaves the active order view',
    !activeResults.some((a: { id: string }) => a.id === res1.id),
    `${activeResults.length} active result(s)`,
  );

  // 21
  const resHistory = await api(`/order-services/${order.id}/attachments/history`, token);
  const histRes = resHistory.find((a: { id: string }) => a.id === res1.id);
  check(
    'removed result remains in history with its original metadata',
    histRes?.recordStatus === 'REMOVED_IN_ERROR' && histRes.fileName === res1.fileName,
    `${histRes?.fileName} — ${histRes?.recordStatus}`,
  );
  const resDownload = await fetch(`${API}/order-services/${order.id}/attachments/${res1.id}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const resBytes = Buffer.from(await resDownload.arrayBuffer());
  check(
    'the original result file is still retrievable',
    resDownload.status === 200 && resBytes.equals(PNG),
    `HTTP ${resDownload.status}, ${resBytes.length} bytes`,
  );
  check('the result file is NOT deleted from disk', await fileExists(resPath!), resPath!);

  // 22
  check(
    'the order relationship survives removal',
    removedRes.orderServiceId === order.id,
    `still attached to order ${order.id.slice(0, 8)}`,
  );

  // 23
  const orderAfter = await api(`/order-services/${order.id}`, token);
  check(
    'the order status is unchanged by removing a result',
    orderAfter.status === orderBefore.status && orderAfter.completedAt === orderBefore.completedAt,
    `${orderBefore.status} → ${orderAfter.status}`,
  );
  check(
    'the order result text is unchanged by removing a result file',
    orderAfter.result === orderBefore.result,
    `"${orderAfter.result}"`,
  );

  // ------------------------------------------------------------ no row was lost
  const totalsAfter = await countPerTenant(STATUS_COUNTS);
  for (const [table, row] of totalsAfter) {
    const before = totalsBefore.get(table)!;
    check(
      `no ${table} row was destroyed by this run`,
      row.n > before,
      `${before} before → ${row.n} after (this run's fixtures added, nothing removed)`,
    );
  }

  // -------------------------------------------- the audit fields are read-only
  for (const [label, path, body] of [
    ['document void audit', `/documents/${doc.id}`, { voidReason: 'rewritten' }],
    ['attachment removal audit', `/visits/${visit.id}/attachments/${img.id}`, { removalReason: 'rewritten' }],
  ] as const) {
    const patch = await call(path, token, 'PATCH', body);
    check(`no route edits the ${label}`, patch.status === 404, `PATCH ${path} → HTTP ${patch.status}`);
  }
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
    await ledger?.cleanup();
    await prisma.$disconnect();
  });
