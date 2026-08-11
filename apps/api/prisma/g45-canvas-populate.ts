import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertFixturesAllowed, fixtureLabel } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G4.5a–c (D-071) — build ONE realistic active visit for the Canvas review
// and print the URL + session to use.
//
// Deliberately NOT self-cleaning: the reviewer needs the record to still be
// there. Nothing numbered is deleted either — invoice numbering is still
// count-based (see the D-068 appendix), so this script only ADDS.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g45-canvas-populate.ts
const API = 'http://localhost:3000';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
}

async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await call(path, token, method, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${r.raw.slice(0, 200)}`);
  return r.body;
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function upload(path: string, token: string, fileName: string) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), fileName);
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  if (res.status >= 400) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  assertFixturesAllowed();

  const tokenFor = (s: { user_id: string; tenant_id: string; staff_id: string; role: string }) =>
    jwt.sign({ sub: s.user_id, tenantId: s.tenant_id, staffId: s.staff_id, role: s.role },
      process.env.JWT_ACCESS_SECRET as string, { expiresIn: '12h' });

  const candidates = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<
      { user_id: string; staff_id: string; tenant_id: string; role: string; full_name: string; tenant_name: string }[]
    >(`SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role, s.full_name, t.name AS tenant_name
       FROM staff s JOIN users u ON s.user_id = u.id JOIN tenants t ON t.id = s.tenant_id
       WHERE s.active
       ORDER BY CASE WHEN s.role::text LIKE 'DOCTOR%' THEN 0 ELSE 1 END, t.name`);
  });

  let seed: (typeof candidates)[number] | undefined;
  let token = '';
  let clinicId = '';
  const probed = new Set<string>();
  for (const candidate of candidates) {
    if (probed.has(candidate.tenant_id)) continue;
    probed.add(candidate.tenant_id);
    const t = tokenFor(candidate);
    const clinics = await call('/clinics', t);
    const services = await call('/services', t);
    const items = await call('/items', t);
    if (clinics.status === 200 && clinics.body.length > 0 && services.body?.length > 0 && items.body?.length > 0) {
      seed = candidate;
      token = t;
      clinicId = clinics.body[0].id;
      break;
    }
  }
  if (!seed) throw new Error('No tenant with a clinic, a service catalogue and inventory items.');
  if (!seed.role.startsWith('DOCTOR')) {
    console.log(`  note: acting as ${seed.role}; G2 restricts diagnosis changes to doctors`);
  }

  const services: { id: string; name: string; orderType: string }[] = await api('/services', token);
  const items: { id: string; name: string }[] = await api('/items', token);
  const taskOrders = services.filter((s) => s.orderType === 'TASK_ORDER');
  const directServices = services.filter((s) => s.orderType === 'STANDARD_SERVICE');
  console.log(`Tenant ${seed.tenant_name}: ${taskOrders.length} TASK_ORDER, ${directServices.length} STANDARD_SERVICE`);

  const stamp = Date.now();
  const patient = await api('/patients', token, 'POST', {
    name: fixtureLabel('G45 Canvas Patient'),
    identifierType: 'PASSPORT',
    identifierValue: `G45${stamp}`.slice(0, 14),
    dob: '2019-04-18',
    gender: 'FEMALE',
    allergies: ['Penicillin', 'Peanut'],
  });

  const visit = await api('/visits', token, 'POST', {
    clinicId, patientId: patient.id, staffId: seed.staff_id,
    billingType: 'Cash',
    presentingComplaint: 'Fever and cough for 3 days',
  });

  await api(`/visits/${visit.id}/observations`, token, 'POST', {
    bpSystolic: 102, bpDiastolic: 64, pulse: 108, temperature: 38.6, spo2: 97, respRate: 26,
    weight: 12.6, height: 92, glucose: 5.2,
  });

  const diagnoses = [
    { name: 'Acute upper respiratory infection', icd10Code: 'J06.9', priority: 'PRIMARY' },
    { name: 'Acute pharyngitis', icd10Code: 'J02.9' },
    { name: 'Allergic rhinitis', icd10Code: 'J30.4' },
    { name: 'Dehydration', icd10Code: 'E86' },
  ];
  for (const diagnosis of diagnoses) {
    await api('/diagnoses', token, 'POST', { visitId: visit.id, ...diagnosis });
  }

  const paediatric = items.find((i: { concVolMl?: string; strengthMg?: string }) => i.concVolMl && i.strengthMg);
  const meds = [
    { item: paediatric ?? items[0], amount: 5, unit: 'ml', frequency: 'TDS', durationDays: 5, quantity: 15,
      remark: 'After food', weight: Boolean(paediatric) },
    { item: items[1] ?? items[0], amount: 1, unit: 'tab', frequency: 'BD', durationDays: 5, quantity: 10, remark: 'For cough' },
    { item: items[2] ?? items[0], amount: 2.5, unit: 'ml', frequency: 'OD', durationDays: 3, quantity: 8, remark: 'At night' },
    { item: items[3] ?? items[0], amount: 1, unit: 'sachet', frequency: 'PRN', durationDays: 3, quantity: 6, remark: 'If loose stool' },
    { item: items[4] ?? items[0], amount: 5, unit: 'ml', frequency: 'QID', durationDays: 2, quantity: 10, remark: 'Gargle' },
  ];
  for (const med of meds) {
    await api('/prescriptions', token, 'POST', {
      visitId: visit.id, itemId: med.item.id, quantity: med.quantity, amount: med.amount,
      unit: med.unit, frequency: med.frequency, durationDays: med.durationDays, remark: med.remark,
      ...(med.weight ? { calcMethod: 'WEIGHT_BASED', calcWeightKg: 12.6, calcDoseRateMgKg: 15 } : {}),
    });
  }

  // 3 TASK_ORDERs across three states, one with a result file.
  if (taskOrders.length > 0) {
    const ordered = await api('/order-services', token, 'POST', { visitId: visit.id, serviceCatalogId: taskOrders[0].id, instruction: 'Fasting not required' });
    void ordered;
    const inProgress = await api('/order-services', token, 'POST', { visitId: visit.id, serviceCatalogId: (taskOrders[1] ?? taskOrders[0]).id });
    await api(`/order-services/${inProgress.id}/start`, token, 'PATCH', {});
    const completed = await api('/order-services', token, 'POST', { visitId: visit.id, serviceCatalogId: (taskOrders[2] ?? taskOrders[0]).id });
    await api(`/order-services/${completed.id}/start`, token, 'PATCH', {});
    await upload(`/order-services/${completed.id}/attachments`, token, 'fbc-result.png');
    await api(`/order-services/${completed.id}/complete`, token, 'PATCH', { result: 'WCC 14.2, CRP 38' });
  }

  // 2 STANDARD_SERVICEs. The catalogue is admin data — top it up rather than
  // reporting a thin panel as if it were the layout's doing.
  let bookableServices = directServices;
  if (bookableServices.length < 2) {
    const extra = await api('/services', token, 'POST', {
      name: fixtureLabel('G45 Dressing'),
      code: `G45-${String(stamp).slice(-6)}`,
      orderType: 'STANDARD_SERVICE',
      price: 25,
      durationMinutesDefault: 15,
    });
    bookableServices = [...bookableServices, extra];
  }
  for (const service of bookableServices.slice(0, 2)) {
    await api('/order-services', token, 'POST', { visitId: visit.id, serviceCatalogId: service.id });
  }

  await upload(`/visits/${visit.id}/attachments`, token, 'throat-photo.png');
  await upload(`/visits/${visit.id}/attachments`, token, 'rash-day2.png');

  await api(`/visits/${visit.id}/clinical-notes`, token, 'POST', {
    notes:
      '<p>3 days of fever to 38.6, barking cough, reduced oral intake but passing urine.</p>' +
      '<p>O/E: alert, well perfused, throat injected, chest clear, no stridor at rest.</p>' +
      '<p>Plan: antipyretics, oral fluids, review in 48h or earlier if stridor at rest.</p>',
    noteLanguage: 'EN', noteType: 'DOCTOR_NARRATIVE',
  });

  await api('/documents', token, 'POST', {
    visitId: visit.id, type: 'MC',
    content: 'MEDICAL CERTIFICATE\n\nUnfit for school for 2 days.',
    startDate: '2026-08-03', endDate: '2026-08-04', diagnosisText: 'Acute upper respiratory infection',
  });

  // Invoice: created, never deleted (numbering is still count-based).
  const invoice = await api('/invoices', token, 'POST', { visitId: visit.id, createdByStaffId: seed.staff_id });
  await api(`/invoices/${invoice.id}/lines`, token, 'POST', { description: 'Consultation', unitPrice: 35 });

  console.log('\n=== G4.5 Canvas review record ===');
  console.log(JSON.stringify({
    url: `http://localhost:5173/patients/${patient.id}?visitId=${visit.id}`,
    patientId: patient.id,
    visitId: visit.id,
    visitNumber: visit.visitNumber,
    auth: {
      accessToken: token, refreshToken: token,
      staff: { id: seed.staff_id, fullName: seed.full_name, role: seed.role, clinicId: null },
      tenant: { id: seed.tenant_id, name: seed.tenant_name, slug: null },
    },
  }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
