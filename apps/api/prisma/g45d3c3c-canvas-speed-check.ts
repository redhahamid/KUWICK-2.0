import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertFixturesAllowed, fixtureLabel } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G4.5d3c-3c — LIVE verification of the Canvas speed and documentation
// closures, against the running API and the real database.
//
// What this proves that a mock harness cannot:
//   - the vitals duplicate guard holds under CONCURRENT submission, with a
//     real PostgreSQL advisory lock and real transactions;
//   - the BMI the server persists matches the browser's calculator exactly;
//   - an unsigned clinical note no longer refuses doctor-phase routing, and
//     the fact that it was pending is written to the append-only event;
//   - the visit still cannot be CLOSED until the note is signed, for every
//     role including the owner;
//   - signing afterwards releases the visit;
//   - Copy Previous writes a supply mode, carrying over what was recorded
//     and defaulting where nothing was;
//   - multi-file upload stores every file, and one rejected file does not
//     roll back the ones that landed.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g45d3c3c-canvas-speed-check.ts
//                                          [--seed-only]
const API = 'http://localhost:3000';
const TENANT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SEED_ONLY = process.argv.includes('--seed-only');

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

async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await call(path, token, method, body);
  if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
}

async function upload(visitId: string, token: string, name: string, type: string, bytes: number) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type }), name);
  const res = await fetch(`${API}/visits/${visitId}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status };
}

interface Ids {
  clinicId: string;
  doctorId: string;
  itemId: string;
}

async function ids(): Promise<Ids> {
  return scoped(async (tx) => {
    const clinic = await tx.clinic.findFirst({ select: { id: true } });
    const item = await tx.item.findFirst({ where: { sellPrice: { gt: 0 } }, select: { id: true } });
    const staff = await tx.staff.findMany({ select: { id: true, role: true } });
    const doctor = staff.find((s) => s.role === 'DOCTOR_RESIDENT' || s.role === 'DOCTOR_LOCUM');
    if (!clinic || !item || !doctor) {
      throw new Error('Dev tenant is missing a clinic, a priced item or a doctor.');
    }
    return { clinicId: clinic.id, doctorId: doctor.id, itemId: item.id };
  });
}

const created: string[] = [];

async function makeVisit(
  i: Ids,
  opts: { label: string; status: string; patientName?: string; doctorCompleted?: boolean },
): Promise<{ visitId: string; patientId: string }> {
  return scoped(async (tx) => {
    const patient = await tx.patient.create({
      data: {
        tenantId: TENANT_ID,
        name: opts.patientName ?? fixtureLabel(opts.label),
        identifierType: 'PASSPORT',
        identifierValue: `SC${Date.now()}${Math.floor(Math.random() * 1000)}`,
      },
    });
    const visit = await tx.visit.create({
      data: {
        tenantId: TENANT_ID,
        clinicId: i.clinicId,
        patientId: patient.id,
        staffId: i.doctorId,
        billingType: 'Self-pay',
        classification: 'FOLLOW_UP_NO_CONSULTATION',
        visitNumber: `SV-${Date.now() % 1000000}-${Math.floor(Math.random() * 100)}`,
        presentingComplaint: fixtureLabel(opts.label),
        doctorCompletedAt: opts.doctorCompleted ? new Date() : null,
        doctorCompletedByStaffId: opts.doctorCompleted ? i.doctorId : null,
      },
    });
    await tx.queueTicket.create({
      data: {
        tenantId: TENANT_ID,
        clinicId: i.clinicId,
        visitId: visit.id,
        ticketNumber: Math.floor(Math.random() * 900) + 100,
        displayNumber: `S${Math.floor(Math.random() * 900) + 100}`,
        queueType: 'WALK_IN',
        status: opts.status as never,
      },
    });
    created.push(visit.id);
    return { visitId: visit.id, patientId: patient.id };
  });
}

/** Writes a SIGNED doctor narrative directly, the way a real signature leaves it. */
async function signNote(visitId: string, i: Ids) {
  await scoped(async (tx) => {
    await tx.clinicalNote.create({
      data: {
        tenantId: TENANT_ID,
        clinicId: i.clinicId,
        visitId,
        notes: '<p>Reviewed. Impression: URTI. Plan: symptomatic treatment.</p>',
        noteLanguage: 'EN',
        noteType: 'DOCTOR_NARRATIVE',
        status: 'SIGNED',
        signedAt: new Date(),
        signedByStaffId: i.doctorId,
        signerNameSnapshot: 'Dr Amira Rahman',
        // `clinical_notes_signature_state_check` makes signature state
        // all-or-nothing: a SIGNED row must carry every signer column, so a
        // DRAFT can never look partly signed. Omitting this one is rejected
        // by the database, which is the constraint working.
        signerRoleSnapshot: 'DOCTOR_RESIDENT',
        authorStaffId: i.doctorId,
        authorNameSnapshot: 'Dr Amira Rahman',
        authorRoleSnapshot: 'DOCTOR_RESIDENT',
        legacyAuthorUnknown: false,
      },
    });
  });
}

const READING = { bpSystolic: 120, bpDiastolic: 80, pulse: 72, temperature: 36.8, weight: 70, height: 170 };

async function main() {
  assertFixturesAllowed();
  const i = await ids();
  const doc = await login('amira.rahman@smoke-test-clinic.test');
  const fd = await login('siti.front@smoke-test-clinic.test');
  const owner = await login('owner.admin@smoke-test-clinic.test');
  const finance = await login('faiz.finance@smoke-test-clinic.test');

  console.log('\nG4.5d3c-3c — Canvas speed and documentation workflow, live');
  console.log('='.repeat(72));

  try {
    if (SEED_ONLY) {
      // Records for the screenshot pass, left in place deliberately.
      const pending = await makeVisit(i, {
        label: 'documentation pending',
        status: 'IN_CONSULTATION',
        patientName: 'Nurul Izzati binti Kamal',
      });
      await api('/prescriptions', doc, 'POST', {
        visitId: pending.visitId,
        itemId: i.itemId,
        quantity: 10,
        amount: 1,
        unit: 'tablet',
        frequency: 'TDS',
        durationDays: 5,
        supplyMode: 'ONSITE_DISPENSE',
      });
      await api(`/visits/${pending.visitId}/observations`, fd, 'POST', READING);

      const signed = await makeVisit(i, {
        label: 'documentation complete',
        status: 'IN_CONSULTATION',
        patientName: 'Tan Chee Meng',
      });
      await signNote(signed.visitId, i);
      await api(`/visits/${signed.visitId}/observations`, fd, 'POST', { ...READING, pulse: 78 });

      console.log('\nSEEDED — use these for the screenshot pass:');
      console.log(`  documentation pending : ${pending.visitId}`);
      console.log(`  documentation signed  : ${signed.visitId}`);
      return;
    }

    // === 1–4. Vitals: BMI and the duplicate guard =========================
    {
      const visit = await makeVisit(i, { label: 'vitals', status: 'IN_CONSULTATION' });

      const first = await api(`/visits/${visit.visitId}/observations`, fd, 'POST', READING);
      check('1. the server persists the same BMI the browser calculates (70kg / 170cm = 24.2)',
        Number(first.bmi) === 24.2, `bmi=${first.bmi}`);
      check('2. a first reading is created, not deduplicated', first.deduplicated === false);

      const repeat = await api(`/visits/${visit.visitId}/observations`, fd, 'POST', READING);
      check('3. re-submitting the identical reading returns the EXISTING row',
        repeat.id === first.id && repeat.deduplicated === true, `id match=${repeat.id === first.id}`);

      const rows = await scoped((tx) => tx.visitObservation.count({ where: { visitId: visit.visitId } }));
      check('4. …and the database holds ONE observation, not two', rows === 1, `${rows} row(s)`);
    }

    // === 5–7. The duplicate guard under real concurrency ==================
    {
      const visit = await makeVisit(i, { label: 'vitals race', status: 'IN_CONSULTATION' });
      const results = await Promise.all(
        Array.from({ length: 4 }, () => call(`/visits/${visit.visitId}/observations`, fd, 'POST', READING)),
      );
      const ok = results.filter((r) => r.status < 400);
      const fresh = ok.filter((r) => r.body?.deduplicated === false);
      const rows = await scoped((tx) => tx.visitObservation.count({ where: { visitId: visit.visitId } }));
      const revisions = await scoped((tx) =>
        tx.visitObservationRevision.count({
          where: { observation: { visitId: visit.visitId } },
        }),
      );
      check('5. four CONCURRENT identical submissions create exactly ONE observation',
        rows === 1, `${rows} row(s), ${fresh.length} reported fresh`);
      check('6. …and exactly ONE audit revision', revisions === 1, `${revisions} revision(s)`);
      check('7. …and every caller got a success, not a race error',
        ok.length === 4, `${ok.length}/4 succeeded`);
    }

    // === 8–9. A genuine repeat reading is still possible ==================
    {
      const visit = await makeVisit(i, { label: 'vitals repeat', status: 'IN_CONSULTATION' });
      await api(`/visits/${visit.visitId}/observations`, fd, 'POST', READING);
      const second = await api(`/visits/${visit.visitId}/observations`, fd, 'POST', { ...READING, bpSystolic: 118 });
      const rows = await scoped((tx) => tx.visitObservation.count({ where: { visitId: visit.visitId } }));
      check('8. a changed value records a NEW reading (repeat BP after treatment)',
        rows === 2 && second.deduplicated === false, `${rows} row(s)`);

      // A DIFFERENT recorder confirming the same reading is a separate act.
      const byDoctor = await api(`/visits/${visit.visitId}/observations`, doc, 'POST', READING);
      const after = await scoped((tx) => tx.visitObservation.count({ where: { visitId: visit.visitId } }));
      check('9. a second person taking the same reading is a separate, attributed act',
        after === 3 && byDoctor.deduplicated === false, `${after} row(s)`);
    }

    // === 10–13. Documentation pending: routing is NOT blocked =============
    {
      const visit = await makeVisit(i, { label: 'unsigned routing', status: 'IN_CONSULTATION' });
      await api('/prescriptions', doc, 'POST', {
        visitId: visit.visitId, itemId: i.itemId, quantity: 10, amount: 1,
        unit: 'tablet', frequency: 'TDS', durationDays: 5, supplyMode: 'ONSITE_DISPENSE',
      });

      const status = await api(`/visits/${visit.visitId}/doctor-phase-status`, doc);
      const codes = (status.blockers ?? []).map((b: { code: string }) => b.code);
      check('10. an unsigned note produces NO doctor-phase blocker',
        !codes.includes('SIGNED_NOTE_REQUIRED') && codes.length === 0, `blockers=[${codes.join(', ')}]`);
      check('11. it is reported as documentationPending instead',
        status.documentationPending === true);
      check('12. routing is still answered — the patient has somewhere to go',
        status.destination === 'DISPENSARY' && status.routingReason === 'DISPENSARY_REQUIRED',
        `${status.destination}/${status.routingReason}`);

      const completed = await call(`/visits/${visit.visitId}/complete-doctor-phase`, doc, 'PATCH', {});
      check('13. the doctor phase COMPLETES with the note unsigned',
        completed.status < 400 && completed.body?.destination === 'DISPENSARY',
        `HTTP ${completed.status}`);
    }

    // === 14–16. It is recorded, with an actor and a time ==================
    {
      const visit = await makeVisit(i, { label: 'pending recorded', status: 'IN_CONSULTATION' });
      await api(`/visits/${visit.visitId}/complete-doctor-phase`, doc, 'PATCH', {});

      const event = await scoped((tx) =>
        tx.visitWorkflowEvent.findFirst({
          where: { visitId: visit.visitId, eventType: 'DOCTOR_PHASE_COMPLETED' },
          select: { metadata: true, actorStaffId: true, actorNameSnapshot: true, createdAt: true },
        }),
      );
      const metadata = (event?.metadata ?? {}) as Record<string, unknown>;
      check('14. the append-only event records that documentation was pending',
        metadata.documentationPending === true, JSON.stringify(metadata));
      check('15. …with the actor who sent the patient on',
        event?.actorStaffId === i.doctorId && Boolean(event?.actorNameSnapshot),
        `${event?.actorNameSnapshot}`);
      check('16. …and the time it happened', event?.createdAt instanceof Date);

      // Nothing was written into the clinical record on the doctor's behalf.
      const notes = await scoped((tx) => tx.clinicalNote.count({ where: { visitId: visit.visitId } }));
      check('17. completion auto-saved and auto-signed NOTHING', notes === 0, `${notes} note(s)`);
    }

    // === 18–21. The visit still cannot CLOSE without a signed note ========
    {
      const visit = await makeVisit(i, { label: 'close blocked', status: 'IN_CONSULTATION' });
      await api(`/visits/${visit.visitId}/complete-doctor-phase`, doc, 'PATCH', {});

      const blockers = await api(`/visits/${visit.visitId}/completion-blockers`, fd);
      const codes = (blockers.blockers ?? blockers ?? []).map((b: { code: string }) => b.code);
      check('18. visit completion reports CLINICAL_DOCUMENTATION_PENDING',
        codes.includes('CLINICAL_DOCUMENTATION_PENDING'), `[${codes.join(', ')}]`);

      for (const [name, token] of [['front desk', fd], ['finance', finance], ['owner', owner]] as const) {
        const refused = await call(`/visits/${visit.visitId}/complete`, token, 'PATCH', {});
        check(`19. ${name} cannot close a visit whose note is unsigned`,
          refused.status === 400, `HTTP ${refused.status}`);
      }

      const stillOpen = await scoped((tx) =>
        tx.visit.findUnique({ where: { id: visit.visitId }, select: { checkOutAt: true } }),
      );
      check('20. …and checkOutAt was never set', stillOpen?.checkOutAt === null);

      // Sign it, and the visit releases.
      await signNote(visit.visitId, i);
      const after = await api(`/visits/${visit.visitId}/completion-blockers`, fd);
      const afterCodes = ((after.blockers ?? after ?? []) as { code: string }[]).map((b) => b.code);
      check('21. signing the note releases the visit for completion',
        !afterCodes.includes('CLINICAL_DOCUMENTATION_PENDING'), `[${afterCodes.join(', ')}]`);
    }

    // === 22–23. A signed note reports documentation complete ==============
    {
      const visit = await makeVisit(i, { label: 'signed routing', status: 'IN_CONSULTATION' });
      await signNote(visit.visitId, i);
      const status = await api(`/visits/${visit.visitId}/doctor-phase-status`, doc);
      check('22. a signed narrative reports documentationPending false',
        status.documentationPending === false);

      await api(`/visits/${visit.visitId}/complete-doctor-phase`, doc, 'PATCH', {});
      const after = await api(`/visits/${visit.visitId}/doctor-phase-status`, doc);
      check('23. the completed phase records documentation as NOT pending',
        after.documentationPendingAtCompletion === false);
    }

    // === 24–25. The recorded answer is not rewritten by signing later =====
    {
      const visit = await makeVisit(i, { label: 'recorded not rewritten', status: 'IN_CONSULTATION' });
      await api(`/visits/${visit.visitId}/complete-doctor-phase`, doc, 'PATCH', {});
      await signNote(visit.visitId, i);

      const status = await api(`/visits/${visit.visitId}/doctor-phase-status`, doc);
      check('24. the RECORDED answer still says documentation was pending at the time',
        status.documentationPendingAtCompletion === true);
      check('25. …while the LIVE answer says it is now complete',
        status.documentationPending === false);
    }

    // === 26–29. Copy Previous writes a supply mode ========================
    {
      const source = await makeVisit(i, { label: 'copy source', status: 'IN_CONSULTATION' });
      const target = await makeVisit(i, { label: 'copy target', status: 'IN_CONSULTATION' });

      // Two source lines: one external, one with NOTHING recorded (legacy).
      await api('/prescriptions', doc, 'POST', {
        visitId: source.visitId, itemId: i.itemId, quantity: 5, amount: 1,
        unit: 'tablet', frequency: 'BD', durationDays: 3, supplyMode: 'EXTERNAL_PRESCRIPTION',
      });
      const legacy = await api('/prescriptions', doc, 'POST', {
        visitId: source.visitId, itemId: i.itemId, quantity: 7, amount: 2,
        unit: 'tablet', frequency: 'TDS', durationDays: 4, supplyMode: 'ONSITE_DISPENSE',
      });
      // Force the legacy shape the compatibility period left behind.
      await scoped((tx) =>
        tx.prescription.update({ where: { id: legacy.id }, data: { supplyMode: null } }),
      );

      const result = await api('/prescriptions/copy', doc, 'POST', {
        sourceVisitId: source.visitId,
        targetVisitId: target.visitId,
      });
      const copied = await scoped((tx) =>
        tx.prescription.findMany({ where: { visitId: target.visitId }, select: { quantity: true, supplyMode: true } }),
      );
      const external = copied.find((p) => p.quantity === 5);
      const defaulted = copied.find((p) => p.quantity === 7);

      check('26. NO copied line arrives with an unresolved supply mode',
        copied.length === 2 && copied.every((p) => p.supplyMode !== null),
        JSON.stringify(copied));
      check('27. a recorded external prescription is carried over, not converted',
        external?.supplyMode === 'EXTERNAL_PRESCRIPTION', `${external?.supplyMode}`);
      check('28. a source that recorded nothing takes the clinic default',
        defaulted?.supplyMode === 'ONSITE_DISPENSE', `${defaulted?.supplyMode}`);
      check('29. the clinic is TOLD what the rule did',
        typeof result.supplySummary === 'string' && result.supplySummary.includes('2 medications copied'),
        result.supplySummary);

      // The SOURCE row's legacy NULL is untouched.
      const stillNull = await scoped((tx) =>
        tx.prescription.findUnique({ where: { id: legacy.id }, select: { supplyMode: true } }),
      );
      check('30. the source visit’s legacy NULL is never rewritten',
        stillNull?.supplyMode === null, `${stillNull?.supplyMode}`);
    }

    // === 31–34. Multi-file upload =========================================
    {
      const visit = await makeVisit(i, { label: 'uploads', status: 'IN_CONSULTATION' });

      const results = [
        await upload(visit.visitId, doc, 'wound-photo.png', 'image/png', 2048),
        await upload(visit.visitId, doc, 'referral-letter.pdf', 'application/pdf', 4096),
        await upload(visit.visitId, doc, 'lab-report.pdf', 'application/pdf', 3072),
      ];
      check('31. every file in a mixed image/PDF batch is stored',
        results.every((r) => r.status < 400), results.map((r) => r.status).join(','));

      const stored = await scoped((tx) =>
        tx.visitAttachment.findMany({ where: { visitId: visit.visitId }, select: { fileName: true, mimeType: true } }),
      );
      check('32. …all three, with their own names and types', stored.length === 3, `${stored.length} stored`);
      check('33. the PDFs are stored AS PDFs, so the record can present them as documents',
        stored.filter((a) => a.mimeType === 'application/pdf').length === 2);

      // A rejected file must not roll back the ones that landed.
      //
      // The rejection used here is the one the server actually performs: the
      // 15 MB size limit on the upload interceptor. (A file-TYPE allow-list
      // does not exist on this endpoint — see the 3c report; the browser's
      // `accept` attribute is a picker hint and stops nothing on the wire.
      // That is a pre-existing gap, reported rather than closed here, because
      // deciding which document types a clinic may attach is the owner's
      // call and not something to change inside an upload-ergonomics fix.)
      const rejected = await upload(visit.visitId, doc, 'huge-scan.pdf', 'application/pdf', 16 * 1024 * 1024);
      const after = await scoped((tx) => tx.visitAttachment.count({ where: { visitId: visit.visitId } }));
      check('34. a REJECTED file leaves the successful uploads in place',
        rejected.status >= 400 && after === 3, `rejected HTTP ${rejected.status}, ${after} kept`);
    }
  } finally {
    if (!SEED_ONLY && created.length > 0) {
      await scoped(async (tx) => {
        const list = created.map((id) => `'${id}'`).join(',');
        await tx.$executeRawUnsafe(`DELETE FROM visit_observation_revisions WHERE observation_id IN (SELECT id FROM visit_observations WHERE visit_id IN (${list}))`);
        await tx.$executeRawUnsafe(`DELETE FROM visit_observations WHERE visit_id IN (${list})`);
        await tx.$executeRawUnsafe(`DELETE FROM clinical_note_revisions WHERE note_id IN (SELECT id FROM clinical_notes WHERE visit_id IN (${list}))`);
        await tx.$executeRawUnsafe(`DELETE FROM clinical_notes WHERE visit_id IN (${list})`);
        await tx.$executeRawUnsafe(`DELETE FROM visit_attachments WHERE visit_id IN (${list})`);
        await tx.$executeRawUnsafe(`DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE visit_id IN (${list}))`);
        await tx.$executeRawUnsafe(`DELETE FROM invoices WHERE visit_id IN (${list})`);
        await tx.$executeRawUnsafe(`DELETE FROM stock_movements WHERE reference_id IN (SELECT id FROM prescriptions WHERE visit_id IN (${list}))`);
        await tx.$executeRawUnsafe(`DELETE FROM prescriptions WHERE visit_id IN (${list})`);
        await tx.$executeRawUnsafe(`DELETE FROM order_services WHERE visit_id IN (${list})`);
        // Append-only workflow events keep their tickets alive; the synthetic
        // rows are closed and their patients soft-deleted instead.
        await tx.$executeRawUnsafe(`UPDATE queue_tickets SET status = 'COMPLETED' WHERE visit_id IN (${list})`);
        await tx.$executeRawUnsafe(`UPDATE visits SET check_out_at = COALESCE(check_out_at, now()) WHERE id IN (${list})`);
        await tx.$executeRawUnsafe(`UPDATE patients SET deleted_at = now() WHERE id IN (SELECT patient_id FROM visits WHERE id IN (${list}))`);
      });
    }
  }

  if (!SEED_ONLY) {
    console.log('='.repeat(72));
    console.log(`${passed} passed, ${failed} failed\n`);
    process.exit(failed === 0 ? 0 : 1);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
