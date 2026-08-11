import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertFixturesAllowed, fixtureLabel } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G4.5d3 (D-077) — ONE professional review patient: a fully populated CURRENT
// visit plus six previous ones, so the whole Canvas can be judged against real
// content rather than an empty shell.
//
//   PowerShell:
//     $env:KUWICK_ALLOW_FIXTURES='yes'; npx tsx prisma/g45d3-professional-canvas.ts
//   bash:
//     KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g45d3-professional-canvas.ts
//
// Attending clinicians are chosen from ACTIVE DOCTOR roles only. The previous
// fixture rotated through whatever staff the tenant had and put a nurse in the
// attending position, which is what made the UI print "DR" over a nurse.
//
// Deliberately NOT self-cleaning — the record has to survive for review.
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
  if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status} ${r.raw.slice(0, 300)}`);
  return r.body;
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function upload(path: string, token: string, fileName: string) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), fileName);
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (res.status >= 400) throw new Error(`POST ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

interface Seed {
  user_id: string;
  staff_id: string;
  tenant_id: string;
  role: string;
  full_name: string;
  tenant_name: string;
}

/** Every scenario the snapshot has to render honestly. */
interface Scenario {
  daysAgo: number;
  /** Clinic-hours check-in, so the history reads like a real week. */
  hour: number;
  minute: number;
  complaint: string;
  diagnoses: { name: string; icd10Code?: string; priority?: 'PRIMARY' }[];
  medications: { name: string; amount: number; unit: string; frequency: string; days: number; qty: number }[];
  documents: { type: string; days?: number; referredTo?: string; content: string }[];
  invoice: { amount: number; pay: boolean } | null;
  panel: boolean;
  note: string;
}

const SCENARIOS: Scenario[] = [
  {
    // 1 — most recent: the full, well-recorded case.
    daysAgo: 12,
    hour: 9,
    minute: 15,
    complaint: 'Fever and cough for 3 days',
    diagnoses: [
      { name: 'Acute upper respiratory infection', icd10Code: 'J06.9', priority: 'PRIMARY' },
      { name: 'Acute pharyngitis', icd10Code: 'J02.9' },
    ],
    medications: [
      { name: 'Paracetamol', amount: 1, unit: 'tab', frequency: 'QID', days: 5, qty: 20 },
      { name: 'Cetirizine', amount: 1, unit: 'tab', frequency: 'ON', days: 5, qty: 5 },
      { name: 'Cough syrup', amount: 10, unit: 'ml', frequency: 'TDS', days: 5, qty: 150 },
    ],
    documents: [{ type: 'MC', days: 2, content: 'Unfit for work for 2 days.' }],
    invoice: { amount: 85, pay: true },
    panel: false,
    note: '<p>3 days of fever and productive cough. Throat injected, chest clear.</p>',
  },
  {
    // 2 — panel billing, unpaid, with an ENT referral.
    daysAgo: 40,
    hour: 11,
    minute: 40,
    complaint: 'Nasal blockage and sneezing every morning',
    diagnoses: [{ name: 'Allergic rhinitis', icd10Code: 'J30.4', priority: 'PRIMARY' }],
    medications: [
      { name: 'Nasal spray', amount: 2, unit: 'spray', frequency: 'BD', days: 14, qty: 1 },
      { name: 'Loratadine', amount: 1, unit: 'tab', frequency: 'OD', days: 14, qty: 14 },
    ],
    documents: [{ type: 'REFERRAL', referredTo: 'ENT Clinic', content: 'Referral to ENT for persistent rhinitis.' }],
    invoice: { amount: 120, pay: false },
    panel: true,
    note: '<p>Morning sneezing and blockage, worse with dust. No fever.</p>',
  },
  {
    // 3 — a memo rather than an MC.
    daysAgo: 78,
    hour: 16,
    minute: 5,
    complaint: 'Right ear pain for 2 days',
    diagnoses: [{ name: 'Otitis externa', icd10Code: 'H60.9', priority: 'PRIMARY' }],
    medications: [
      { name: 'Ear drops', amount: 3, unit: 'drop', frequency: 'TDS', days: 7, qty: 1 },
      { name: 'Ibuprofen', amount: 1, unit: 'tab', frequency: 'TDS', days: 5, qty: 15 },
    ],
    documents: [{ type: 'MEMO', content: 'Advised to keep the ear dry while swimming.' }],
    invoice: { amount: 65, pay: true },
    panel: false,
    note: '<p>Canal inflamed and tender, tympanic membrane not visualised.</p>',
  },
  {
    // 4 — multiple diagnoses, MC for one day.
    daysAgo: 120,
    hour: 10,
    minute: 20,
    complaint: 'Vomiting and loose stool since last night',
    diagnoses: [
      { name: 'Acute gastroenteritis', icd10Code: 'A09', priority: 'PRIMARY' },
      { name: 'Dehydration', icd10Code: 'E86' },
      { name: 'Electrolyte imbalance', icd10Code: 'E87.8' },
    ],
    medications: [
      { name: 'ORS Sachets', amount: 1, unit: 'sachet', frequency: 'PRN', days: 3, qty: 10 },
      { name: 'Buscopan', amount: 1, unit: 'tab', frequency: 'TDS', days: 3, qty: 9 },
    ],
    documents: [{ type: 'MC', days: 1, content: 'Unfit for work for 1 day.' }],
    invoice: { amount: 95, pay: true },
    panel: false,
    note: '<p>Six episodes overnight, tolerating sips. Abdomen soft.</p>',
  },
  {
    // 5 — no document at all.
    daysAgo: 190,
    hour: 14,
    minute: 50,
    complaint: 'Itchy rash on both forearms',
    diagnoses: [{ name: 'Contact dermatitis', icd10Code: 'L25.9', priority: 'PRIMARY' }],
    medications: [
      { name: 'Hydrocortisone cream', amount: 1, unit: 'application', frequency: 'BD', days: 7, qty: 1 },
      { name: 'Chlorpheniramine', amount: 1, unit: 'tab', frequency: 'ON', days: 7, qty: 7 },
    ],
    documents: [],
    invoice: { amount: 70, pay: true },
    panel: false,
    note: '<p>Erythematous patches, no vesicles. New detergent last week.</p>',
  },
  {
    // 6 — the legacy record: no recorded priority, no medication, no invoice.
    daysAgo: 300,
    hour: 8,
    minute: 45,
    complaint: 'Routine review',
    diagnoses: [{ name: 'Hypertension follow-up', icd10Code: 'I10' }],
    medications: [],
    documents: [],
    invoice: null,
    panel: false,
    note: '<p>Legacy record migrated from the previous system.</p>',
  },
];

async function main() {
  assertFixturesAllowed();

  const tokenFor = (s: Seed) =>
    jwt.sign(
      { sub: s.user_id, tenantId: s.tenant_id, staffId: s.staff_id, role: s.role },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: '12h' },
    );

  const candidates = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<Seed[]>(
      `SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role, s.full_name, t.name AS tenant_name
         FROM staff s JOIN users u ON s.user_id = u.id JOIN tenants t ON t.id = s.tenant_id
        WHERE s.active
        ORDER BY CASE WHEN s.role::text LIKE 'DOCTOR%' THEN 0 ELSE 1 END, t.name`,
    );
  });

  let seed: Seed | undefined;
  let token = '';
  let clinicId = '';
  const probed = new Set<string>();
  for (const candidate of candidates) {
    if (probed.has(candidate.tenant_id)) continue;
    probed.add(candidate.tenant_id);
    const t = tokenFor(candidate);
    const clinics = await call('/clinics', t);
    const items = await call('/items', t);
    if (clinics.status === 200 && clinics.body?.length > 0 && items.body?.length > 0) {
      seed = candidate;
      token = t;
      clinicId = clinics.body[0].id;
      break;
    }
  }
  if (!seed) throw new Error('No tenant with a clinic and inventory items.');

  // Different attending doctors across the history, where the tenant has them.
  // D-077 — attending clinicians for a GP scenario must be DOCTORS. The
  // previous fixture took "the next active staff member in the tenant", which
  // is how a nurse ended up in the attending position and the UI ended up
  // printing a doctor's title over her name.
  const DOCTOR_ROLES = ['DOCTOR_RESIDENT', 'DOCTOR_LOCUM', 'DOCTOR_VISITING', 'DOCTOR'];
  const sameTenant = candidates.filter((c) => c.tenant_id === seed!.tenant_id);
  const doctors = sameTenant.filter((c) => DOCTOR_ROLES.includes(c.role));
  if (doctors.length === 0) {
    throw new Error(
      'No active doctor in this tenant. A GP review fixture must not put a non-doctor in the attending position.',
    );
  }
  console.log(`attending doctors: ${doctors.map((d) => d.full_name).join(', ')}`);
  const items: { id: string; name: string }[] = await api('/items', token);
  const panels: { id: string; name: string }[] = await call('/panel-clinics', token).then(
    (r) => (r.status === 200 ? r.body : []),
  );

  const stamp = Date.now();
  const patient = await api('/patients', token, 'POST', {
    name: fixtureLabel('G45 Professional Canvas'),
    identifierType: 'PASSPORT',
    identifierValue: `H${stamp}`.slice(0, 14),
    dob: '1988-02-14',
    gender: 'MALE',
    allergies: ['Penicillin'],
  });

  console.log(`\nG4.5d2 — SEEDING HISTORY for ${patient.name}`);
  console.log('='.repeat(78));

  // Oldest first, so the visit numbers run in the same order as the dates.
  const ordered = [...SCENARIOS].sort((a, b) => b.daysAgo - a.daysAgo);
  for (const [index, scenario] of ordered.entries()) {
    const attending = doctors[index % doctors.length];
    const panelClinic = scenario.panel && panels.length > 0 ? panels[0] : undefined;

    const visit = await api('/visits', token, 'POST', {
      clinicId,
      patientId: patient.id,
      staffId: attending.staff_id,
      billingType: panelClinic ? 'Panel' : 'Cash',
      panelClinicId: panelClinic?.id,
      presentingComplaint: scenario.complaint,
    });

    for (const diagnosis of scenario.diagnoses) {
      await api('/diagnoses', token, 'POST', { visitId: visit.id, ...diagnosis });
    }
    for (const [i, med] of scenario.medications.entries()) {
      await api('/prescriptions', token, 'POST', {
        visitId: visit.id,
        itemId: items[i % items.length].id,
        quantity: med.qty,
        amount: med.amount,
        unit: med.unit,
        frequency: med.frequency,
        durationDays: med.days,
        remark: med.name,
      });
    }
    for (const doc of scenario.documents) {
      const start = new Date(Date.now() - scenario.daysAgo * 86400000);
      const end = new Date(start.getTime() + ((doc.days ?? 1) - 1) * 86400000);
      await api('/documents', token, 'POST', {
        visitId: visit.id,
        type: doc.type,
        content: doc.content,
        ...(doc.days ? { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) } : {}),
        ...(doc.referredTo ? { referredTo: doc.referredTo } : {}),
        diagnosisText: scenario.diagnoses[0]?.name,
      });
    }
    await api(`/visits/${visit.id}/clinical-notes`, token, 'POST', {
      notes: scenario.note,
      noteLanguage: 'EN',
      noteType: 'DOCTOR_NARRATIVE',
    });

    if (scenario.invoice) {
      const invoice = await api('/invoices', token, 'POST', {
        visitId: visit.id,
        createdByStaffId: seed.staff_id,
      });
      await api(`/invoices/${invoice.id}/lines`, token, 'POST', {
        description: 'Consultation and medication',
        unitPrice: scenario.invoice.amount,
      });
      if (scenario.invoice.pay) {
        // Billing roles, not the attending-doctor list — narrowing `doctors`
        // to DOCTOR roles silently removed every staff member who may take
        // payment, so the PAID scenarios came out UNPAID.
        const payer = sameTenant.find((d) =>
          ['OWNER_ADMIN', 'FINANCE_STAFF', 'FRONT_DESK_CLINICAL_STAFF'].includes(d.role),
        );
        if (payer) {
          await api(`/invoices/${invoice.id}/pay`, tokenFor(payer), 'PATCH', { paymentMethod: 'CASH' });
        }
      }
    }

    // Backdate ONLY the check-in, so the history reads as a real timeline.
    // Everything else was written through the API with its real rules.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${seed!.tenant_id}, true)`;
      await tx.$executeRawUnsafe(
        // D-077 — a real clinic day, not every visit at the same minute. The
        // hour comes from the scenario, so a deterministic reset reproduces
        // exactly the same timeline.
        `UPDATE visits
            SET check_in_at  = date_trunc('day', now() - interval '${scenario.daysAgo} days')
                               + interval '${scenario.hour} hours' + interval '${scenario.minute} minutes',
                check_out_at = date_trunc('day', now() - interval '${scenario.daysAgo} days')
                               + interval '${scenario.hour} hours' + interval '${scenario.minute + 35} minutes'
          WHERE id = '${visit.id}'`,
      );
    });

    console.log(
      `  ${visit.visitNumber}  ${String(scenario.daysAgo).padStart(3)}d ago  ${scenario.diagnoses[0].name}` +
        `  meds:${scenario.medications.length} docs:${scenario.documents.length}` +
        `  ${scenario.invoice ? `RM${scenario.invoice.amount} ${scenario.invoice.pay ? 'PAID' : 'UNPAID'}` : 'no invoice'}` +
        `${panelClinic ? ` panel:${panelClinic.name}` : ''}`,
    );
  }

  // ---------------------------------------------------------------------
  // The CURRENT visit — fully populated, so the whole Canvas can be judged
  // against real content. Deliberately left with NO saved clinical note, so
  // C1's unsaved-draft safety can be exercised in the browser.
  // ---------------------------------------------------------------------
  const current = await api('/visits', token, 'POST', {
    clinicId,
    patientId: patient.id,
    staffId: doctors[0].staff_id,
    billingType: 'Cash',
    presentingComplaint: 'Sore throat and fever since yesterday',
  });

  await api(`/visits/${current.id}/observations`, token, 'POST', {
    bpSystolic: 118, bpDiastolic: 76, pulse: 82, temperature: 37.4,
    spo2: 99, respRate: 18, weight: 68, height: 172, glucose: 5.4,
  });

  // Four diagnoses, exactly one explicitly PRIMARY.
  for (const diagnosis of [
    { name: 'Acute tonsillitis', icd10Code: 'J03.9', priority: 'PRIMARY' },
    { name: 'Acute upper respiratory infection', icd10Code: 'J06.9' },
    { name: 'Allergic rhinitis', icd10Code: 'J30.4' },
    { name: 'Vitamin D deficiency', icd10Code: 'E55.9' },
  ]) {
    await api('/diagnoses', token, 'POST', { visitId: current.id, ...diagnosis });
  }

  // Five medications — more than the panel's preview limit, so "View all"
  // and the "+N more" summary both have something to prove.
  const currentMeds = [
    { amount: 1, unit: 'tab', frequency: 'QID', days: 5, qty: 20, remark: 'After food' },
    { amount: 1, unit: 'tab', frequency: 'BD', days: 5, qty: 10, remark: 'For pain' },
    { amount: 10, unit: 'ml', frequency: 'TDS', days: 5, qty: 150, remark: 'Gargle' },
    { amount: 1, unit: 'tab', frequency: 'ON', days: 7, qty: 7, remark: 'Drowsiness expected' },
    { amount: 1, unit: 'cap', frequency: 'OD', days: 30, qty: 30, remark: 'Long course' },
  ];
  for (const [i, med] of currentMeds.entries()) {
    await api('/prescriptions', token, 'POST', {
      visitId: current.id,
      itemId: items[i % items.length].id,
      quantity: med.qty,
      amount: med.amount,
      unit: med.unit,
      frequency: med.frequency,
      durationDays: med.days,
      remark: med.remark,
    });
  }

  // Three TASK_ORDERs, one in each state the rail renders differently.
  const services: { id: string; name: string; orderType: string }[] = await api('/services', token);
  const taskOrders = services.filter((s) => s.orderType === 'TASK_ORDER');
  const directServices = services.filter((s) => s.orderType === 'STANDARD_SERVICE');

  if (taskOrders.length > 0) {
    await api('/order-services', token, 'POST', {
      visitId: current.id,
      serviceCatalogId: taskOrders[0].id,
      instruction: 'Fasting not required',
    });
    const inProgress = await api('/order-services', token, 'POST', {
      visitId: current.id,
      serviceCatalogId: (taskOrders[1] ?? taskOrders[0]).id,
    });
    await api(`/order-services/${inProgress.id}/start`, token, 'PATCH', {});
    const completed = await api('/order-services', token, 'POST', {
      visitId: current.id,
      serviceCatalogId: (taskOrders[2] ?? taskOrders[0]).id,
    });
    await api(`/order-services/${completed.id}/start`, token, 'PATCH', {});
    await api(`/order-services/${completed.id}/complete`, token, 'PATCH', { result: 'WCC 12.8, CRP 22' });
  }

  // Two direct services — created COMPLETED by the approved G4.5s rule.
  for (const service of directServices.slice(0, 2)) {
    await api('/order-services', token, 'POST', { visitId: current.id, serviceCatalogId: service.id });
  }

  // Two clinical images.
  await upload(`/visits/${current.id}/attachments`, token, 'throat-photo.png');
  await upload(`/visits/${current.id}/attachments`, token, 'tonsils-day2.png');

  // An active MC and a referral on the CURRENT visit.
  const mcStart = new Date();
  const mcEnd = new Date(mcStart.getTime() + 86400000);
  await api('/documents', token, 'POST', {
    visitId: current.id,
    type: 'MC',
    content: 'MEDICAL CERTIFICATE\n\nUnfit for work for 2 days.',
    startDate: mcStart.toISOString().slice(0, 10),
    endDate: mcEnd.toISOString().slice(0, 10),
    diagnosisText: 'Acute tonsillitis',
  });
  await api('/documents', token, 'POST', {
    visitId: current.id,
    type: 'REFERRAL',
    content: 'Referral to ENT for recurrent tonsillitis.',
    referredTo: 'ENT Clinic',
    diagnosisText: 'Acute tonsillitis',
  });

  // One invoice, left UNPAID so the completion bar shows a real state.
  const currentInvoice = await api('/invoices', token, 'POST', {
    visitId: current.id,
    createdByStaffId: seed.staff_id,
  });
  await api(`/invoices/${currentInvoice.id}/lines`, token, 'POST', {
    description: 'Consultation',
    unitPrice: 35,
  });

  console.log(`\n  CURRENT ${current.visitNumber} — 4 diagnoses, 5 medications, 3 orders,`);
  console.log(`             ${directServices.slice(0, 2).length} direct services, MC + referral, 1 invoice,`);
  console.log(`             2 images, vitals recorded, NO saved clinical note (for C1 checks)`);
  console.log(`             attending: ${doctors[0].full_name} (${doctors[0].role})`);

  console.log('\n=== G4.5d2 review record ===');
  console.log(
    JSON.stringify({
      url: `http://localhost:5173/patients/${patient.id}?visitId=${current.id}`,
      patientId: patient.id,
      currentVisitId: current.id,
      auth: {
        accessToken: token,
        refreshToken: token,
        staff: { id: seed.staff_id, fullName: seed.full_name, role: seed.role, clinicId: null },
        tenant: { id: seed.tenant_id, name: seed.tenant_name, slug: null },
      },
    }),
  );
}

/** Guards against a tenant with a single staff member. */
function atLeastOne(list: unknown[]): number {
  return Math.max(list.length, 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
