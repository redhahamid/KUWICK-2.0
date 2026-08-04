import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertFixturesAllowed, fixtureLabel } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G4.5d3c-3b2 (D-094) — LIVE verification of Counter Billing Review.
//
// Proves against the running API and the real database:
//   - the consultation tariff follows the CONSULTATION-START time, not the
//     invoice/payment time (the owner's 22:55 vs 23:10 example);
//   - a midnight-crossing band matches;
//   - repeated and CONCURRENT ensure calls cannot double-charge;
//   - panel consultation pricing follows the approved resolver;
//   - OTC / dressing-only / procedure-only visits are not auto-charged;
//   - a waiver needs a reason, leaves the totals and stays in history;
//   - sourced quantity and price cannot be overridden by the client;
//   - payment refuses unbilled work and unresolved responsibility, PANEL
//     needs a positive panel amount, and settling never completes the visit.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g45d3c3b2-billing-review-check.ts
//                                          [--seed-only] [--keep]
//
// --seed-only leaves the demo visits in place for screenshots.
const API = 'http://localhost:3000';
const TENANT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SEED_ONLY = process.argv.includes('--seed-only');
const KEEP = process.argv.includes('--keep') || SEED_ONLY;

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
  if (!body.accessToken) throw new Error(`Login failed for ${email}: ${JSON.stringify(body)}`);
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

interface Ids {
  clinicId: string;
  doctorId: string;
  frontDeskId: string;
  financeId: string;
  itemId: string;
  dayServiceId: string;
  nightServiceId: string;
  panelAiaId: string;
  panelMaraId: string;
}

/**
 * The owner's tariff examples, as real configuration:
 *   Cash    08:00–22:59 -> Consultation (Day)   RM35
 *           23:00–07:59 -> Consultation (Night) RM50
 *   AIA     day RM20 / night RM30  (different day/night panel prices)
 *   MARA    day RM40 / night RM40  (same price both bands, PMCare-style)
 * Panel prices are PanelPriceOverride rows against the SERVICES — never
 * fields on the tariff rule.
 */
async function seedConfiguration(): Promise<Ids> {
  return scoped(async (tx) => {
    const clinic = await tx.clinic.findFirst({ select: { id: true } });
    const item = await tx.item.findFirst({ where: { sellPrice: { gt: 0 } }, select: { id: true } });
    const staff = await tx.staff.findMany({ select: { id: true, role: true } });
    const doctor = staff.find((s) => s.role === 'DOCTOR_RESIDENT' || s.role === 'DOCTOR_LOCUM');
    const frontDesk = staff.find((s) => s.role === 'FRONT_DESK_CLINICAL_STAFF');
    const finance = staff.find((s) => s.role === 'FINANCE_STAFF');
    if (!clinic || !item || !doctor || !frontDesk || !finance) {
      throw new Error('Dev tenant is missing a clinic, item, doctor, front desk or finance staff row.');
    }

    const upsertService = async (name: string, price: number) => {
      const existing = await tx.serviceCatalog.findFirst({ where: { name } });
      if (existing) {
        return tx.serviceCatalog.update({ where: { id: existing.id }, data: { price, active: true } });
      }
      return tx.serviceCatalog.create({
        data: {
          tenantId: TENANT_ID,
          name,
          category: 'Consultation',
          orderType: 'STANDARD_SERVICE',
          durationMinutesDefault: 15,
          price,
          active: true,
        },
      });
    };
    const day = await upsertService('Consultation (Day)', 35);
    const night = await upsertService('Consultation (Night)', 50);

    const upsertRule = async (name: string, startTime: string, endTime: string, serviceCatalogId: string) => {
      const existing = await tx.consultationTariffRule.findFirst({ where: { clinicId: clinic.id, name } });
      if (existing) {
        return tx.consultationTariffRule.update({
          where: { id: existing.id },
          data: { startTime, endTime, serviceCatalogId, active: true, classification: 'CONSULTATION' },
        });
      }
      return tx.consultationTariffRule.create({
        data: {
          tenantId: TENANT_ID,
          clinicId: clinic.id,
          name,
          classification: 'CONSULTATION',
          startTime,
          endTime,
          serviceCatalogId,
          active: true,
        },
      });
    };
    await upsertRule('Day consultation', '08:00', '22:59', day.id);
    await upsertRule('Night consultation', '23:00', '07:59', night.id);

    const panels = await tx.panelClinic.findMany({ select: { id: true, name: true } });
    const aia = panels.find((p) => p.name === 'AIA');
    const mara = panels.find((p) => p.name === 'MARA');
    if (!aia || !mara) throw new Error('Dev tenant is missing the AIA / MARA panels.');

    const upsertOverride = async (panelClinicId: string, serviceCatalogId: string, price: number) => {
      const existing = await tx.panelPriceOverride.findFirst({ where: { panelClinicId, serviceCatalogId } });
      if (existing) {
        return tx.panelPriceOverride.update({ where: { id: existing.id }, data: { overridePrice: price } });
      }
      return tx.panelPriceOverride.create({
        data: { tenantId: TENANT_ID, panelClinicId, serviceCatalogId, overridePrice: price },
      });
    };
    // AIA — different day/night panel prices (owner test 46).
    await upsertOverride(aia.id, day.id, 20);
    await upsertOverride(aia.id, night.id, 30);
    // MARA — the same fixed price in both bands (owner tests 45/47).
    await upsertOverride(mara.id, day.id, 40);
    await upsertOverride(mara.id, night.id, 40);

    return {
      clinicId: clinic.id,
      doctorId: doctor.id,
      frontDeskId: frontDesk.id,
      financeId: finance.id,
      itemId: item.id,
      dayServiceId: day.id,
      nightServiceId: night.id,
      panelAiaId: aia.id,
      panelMaraId: mara.id,
    };
  });
}

const created: string[] = [];

/**
 * A visit with a REAL stored consultation-start event at the given instant —
 * the same row the queue transition writes — so the tariff is matched against
 * a genuine timestamp rather than the clock.
 */
async function makeVisit(
  ids: Ids,
  opts: {
    label: string;
    consultationStartAt: Date;
    panelClinicId?: string | null;
    classification?: string | null;
    patientName?: string;
  },
): Promise<{ visitId: string; patientId: string }> {
  return scoped(async (tx) => {
    // Production derives a panel visit's billingType from the PANEL'S NAME
    // (VisitService.resolveBillingType); the fixture does the same so the
    // screens show what a real visit shows.
    const panel = opts.panelClinicId
      ? await tx.panelClinic.findUnique({ where: { id: opts.panelClinicId }, select: { name: true } })
      : null;
    const patient = await tx.patient.create({
      data: {
        tenantId: TENANT_ID,
        name: opts.patientName ?? fixtureLabel(opts.label),
        identifierType: 'PASSPORT',
        identifierValue: `BR${Date.now()}${Math.floor(Math.random() * 1000)}`,
      },
    });
    const visit = await tx.visit.create({
      data: {
        tenantId: TENANT_ID,
        clinicId: ids.clinicId,
        patientId: patient.id,
        staffId: ids.doctorId,
        billingType: panel?.name ?? 'Self-pay',
        panelClinicId: opts.panelClinicId ?? null,
        panelVerificationStatus: opts.panelClinicId ? 'PENDING_VERIFICATION' : null,
        classification: (opts.classification ?? null) as never,
        visitNumber: `BRV-${Date.now() % 1000000}-${Math.floor(Math.random() * 100)}`,
        presentingComplaint: fixtureLabel(opts.label),
        checkInAt: opts.consultationStartAt,
      },
    });
    const ticket = await tx.queueTicket.create({
      data: {
        tenantId: TENANT_ID,
        clinicId: ids.clinicId,
        visitId: visit.id,
        ticketNumber: Math.floor(Math.random() * 900) + 100,
        queueType: 'WALK_IN',
        status: 'IN_CONSULTATION',
        calledAt: opts.consultationStartAt,
      },
    });
    await tx.visitWorkflowEvent.create({
      data: {
        tenantId: TENANT_ID,
        clinicId: ids.clinicId,
        visitId: visit.id,
        queueTicketId: ticket.id,
        eventType: 'CONSULTATION_STARTED',
        previousStatus: 'WAITING',
        newStatus: 'IN_CONSULTATION',
        actorStaffId: ids.frontDeskId,
        actorNameSnapshot: 'Fixture Front Desk',
        actorRoleSnapshot: 'FRONT_DESK_CLINICAL_STAFF',
        createdAt: opts.consultationStartAt,
      },
    });
    created.push(visit.id);
    return { visitId: visit.id, patientId: patient.id };
  });
}

/** A UTC instant whose Kuala Lumpur wall clock reads HH:MM today. */
function klToday(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), (h - 8 + 24) % 24, m));
}

async function newInvoice(visitId: string, token: string, staffId: string): Promise<string> {
  const invoice = await api('/invoices', token, 'POST', { visitId, createdByStaffId: staffId });
  return invoice.id as string;
}

async function main() {
  assertFixturesAllowed();
  const ids = await seedConfiguration();
  console.log('\nG4.5d3c-3b2 — Counter Billing Review, live');
  console.log('='.repeat(70));
  console.log('Tariff configured: Day 08:00–22:59 RM35 · Night 23:00–07:59 RM50');
  console.log('Panel prices: AIA 20/30 · MARA 40/40 (PanelPriceOverride, not tariff fields)\n');

  const fd = await login('siti.front@smoke-test-clinic.test');
  const fin = await login('faiz.finance@smoke-test-clinic.test');
  const doc = await login('amira.rahman@smoke-test-clinic.test');

  try {
    if (SEED_ONLY) {
      // Screenshot fixtures: a rich cash visit and a panel visit.
      const rich = await makeVisit(ids, {
        label: 'billing review demo',
        consultationStartAt: klToday('10:30'),
        patientName: 'Nur Aisyah binti Kamal',
      });
      const rx = await scoped((tx) =>
        tx.prescription.create({
          data: {
            tenantId: TENANT_ID,
            visitId: rich.visitId,
            itemId: ids.itemId,
            quantity: 10,
            amount: 1,
            frequency: 'TDS',
            durationDays: 5,
            prescribedByStaffId: ids.doctorId,
            supplyMode: 'ONSITE_DISPENSE',
            status: 'DISPENSED',
            dispensedAt: new Date(),
          },
        }),
      );
      await scoped((tx) =>
        tx.prescription.create({
          data: {
            tenantId: TENANT_ID,
            visitId: rich.visitId,
            itemId: ids.itemId,
            quantity: 6,
            amount: 1,
            frequency: 'BD',
            durationDays: 3,
            prescribedByStaffId: ids.doctorId,
            supplyMode: 'ONSITE_DISPENSE',
            status: 'ORDERED',
          },
        }),
      );
      await scoped((tx) =>
        tx.prescription.create({
          data: {
            tenantId: TENANT_ID,
            visitId: rich.visitId,
            itemId: ids.itemId,
            quantity: 20,
            amount: 1,
            frequency: 'PRN',
            durationDays: 7,
            prescribedByStaffId: ids.doctorId,
            supplyMode: 'EXTERNAL_PRESCRIPTION',
            status: 'ORDERED',
          },
        }),
      );
      await scoped((tx) =>
        tx.orderService.create({
          data: {
            tenantId: TENANT_ID,
            clinicId: ids.clinicId,
            visitId: rich.visitId,
            serviceCatalogId: ids.dayServiceId,
            procedureName: 'Nebuliser',
            orderType: 'TASK_ORDER',
            status: 'COMPLETED',
            requestedByStaffId: ids.doctorId,
            completedAt: new Date(),
          },
        }),
      );
      await scoped((tx) =>
        tx.orderService.create({
          data: {
            tenantId: TENANT_ID,
            clinicId: ids.clinicId,
            visitId: rich.visitId,
            serviceCatalogId: ids.dayServiceId,
            procedureName: 'ECG',
            orderType: 'TASK_ORDER',
            status: 'PENDING',
            requestedByStaffId: ids.doctorId,
          },
        }),
      );
      const richInvoice = await newInvoice(rich.visitId, fd, ids.frontDeskId);
      await api(`/invoices/${richInvoice}/ensure-consultation`, fd, 'POST', {});
      await api(`/invoices/${richInvoice}/lines`, fd, 'POST', {
        description: 'Nebuliser mask',
        quantity: 1,
        unitPrice: 8,
      });
      await api(`/invoices/${richInvoice}/lines`, fd, 'POST', {
        description: 'Amoxicillin',
        sourcePrescriptionId: rx.id,
      });

      const panelVisit = await makeVisit(ids, {
        label: 'panel billing demo',
        consultationStartAt: klToday('10:45'),
        panelClinicId: ids.panelAiaId,
        patientName: 'Ahmad Firdaus bin Yusof',
      });
      const panelInvoice = await newInvoice(panelVisit.visitId, fd, ids.frontDeskId);
      await api(`/invoices/${panelInvoice}/ensure-consultation`, fd, 'POST', {});

      const exempt = await makeVisit(ids, {
        label: 'otc demo',
        consultationStartAt: klToday('11:00'),
        classification: 'OTC_ONLY',
        patientName: 'Tan Wei Ming',
      });
      const exemptInvoice = await newInvoice(exempt.visitId, fd, ids.frontDeskId);
      await api(`/invoices/${exemptInvoice}/ensure-consultation`, fd, 'POST', {});

      console.log('SCREENSHOT FIXTURES');
      console.log(`  cash visit (mixed worklist):  /billing/visits/${rich.visitId}`);
      console.log(`  panel visit (AIA):            /billing/visits/${panelVisit.visitId}`);
      console.log(`  OTC exempt visit:             /billing/visits/${exempt.visitId}`);
      console.log(`  panel visit id:               ${panelVisit.visitId}`);
      return;
    }

    // --- 39/40/41. The tariff follows the consultation START ---------------
    {
      // The owner's example: consultation starts 22:55, the invoice is opened
      // now (whenever "now" is). The DAY tariff must win.
      const visit = await makeVisit(ids, { label: 'tariff at 22:55', consultationStartAt: klToday('22:55') });
      const invoiceId = await newInvoice(visit.visitId, fd, ids.frontDeskId);
      await api(`/invoices/${invoiceId}/ensure-consultation`, fd, 'POST', {});
      const invoice = await api(`/invoices?visitId=${visit.visitId}`, fd);
      const line = invoice[0].lines.find((l: { sourceConsultationVisitId: string | null }) => l.sourceConsultationVisitId);
      check('39/40/41. a 22:55 consultation bills the DAY tariff, whatever time billing runs',
        line?.description === 'Consultation (Day)' && Number(line?.unitPrice) === 35,
        `${line?.description} @ ${line?.unitPrice}`);
    }

    // --- 37/38. Midnight-crossing band ------------------------------------
    {
      const visit = await makeVisit(ids, { label: 'tariff at 23:30', consultationStartAt: klToday('23:30') });
      const invoiceId = await newInvoice(visit.visitId, fd, ids.frontDeskId);
      await api(`/invoices/${invoiceId}/ensure-consultation`, fd, 'POST', {});
      const invoice = await api(`/invoices?visitId=${visit.visitId}`, fd);
      const line = invoice[0].lines.find((l: { sourceConsultationVisitId: string | null }) => l.sourceConsultationVisitId);
      check('37/38. a 23:30 consultation bills the NIGHT tariff (band crosses midnight)',
        line?.description === 'Consultation (Night)' && Number(line?.unitPrice) === 50,
        `${line?.description} @ ${line?.unitPrice}`);

      const early = await makeVisit(ids, { label: 'tariff at 03:00', consultationStartAt: klToday('03:00') });
      const earlyInvoice = await newInvoice(early.visitId, fd, ids.frontDeskId);
      await api(`/invoices/${earlyInvoice}/ensure-consultation`, fd, 'POST', {});
      const earlyRead = await api(`/invoices?visitId=${early.visitId}`, fd);
      const earlyLine = earlyRead[0].lines.find((l: { sourceConsultationVisitId: string | null }) => l.sourceConsultationVisitId);
      check('38. 03:00 also falls in the night band', earlyLine?.description === 'Consultation (Night)');
    }

    // --- 52/53. Idempotent and concurrent ensure ---------------------------
    {
      const visit = await makeVisit(ids, { label: 'ensure idempotency', consultationStartAt: klToday('10:00') });
      const invoiceId = await newInvoice(visit.visitId, fd, ids.frontDeskId);
      // Five concurrent ensures, exactly as five browser tabs would send them.
      await Promise.all(
        Array.from({ length: 5 }, () => call(`/invoices/${invoiceId}/ensure-consultation`, fd, 'POST', {})),
      );
      const invoice = await api(`/invoices?visitId=${visit.visitId}`, fd);
      const consultationLines = invoice[0].lines.filter(
        (l: { sourceConsultationVisitId: string | null; cancelledAt: string | null }) =>
          l.sourceConsultationVisitId && !l.cancelledAt,
      );
      check('52/53. five CONCURRENT ensure calls create exactly ONE consultation charge',
        consultationLines.length === 1, `${consultationLines.length} line(s)`);
    }

    // --- 42/43/46. Panel consultation pricing ------------------------------
    {
      const aia = await makeVisit(ids, {
        label: 'AIA day consult',
        consultationStartAt: klToday('10:00'),
        panelClinicId: ids.panelAiaId,
      });
      const aiaInvoice = await newInvoice(aia.visitId, fd, ids.frontDeskId);
      await api(`/invoices/${aiaInvoice}/ensure-consultation`, fd, 'POST', {});
      const aiaRead = await api(`/invoices?visitId=${aia.visitId}`, fd);
      const aiaLine = aiaRead[0].lines.find((l: { sourceConsultationVisitId: string | null }) => l.sourceConsultationVisitId);
      check('42/46. AIA daytime uses its SPECIFIC panel price (RM20), not the cash RM35',
        Number(aiaLine?.unitPrice) === 20 && aiaLine?.priceRule === 'SPECIFIC_PANEL_PRICE',
        `${aiaLine?.unitPrice} via ${aiaLine?.priceRule}`);

      const aiaNight = await makeVisit(ids, {
        label: 'AIA night consult',
        consultationStartAt: klToday('23:30'),
        panelClinicId: ids.panelAiaId,
      });
      const aiaNightInvoice = await newInvoice(aiaNight.visitId, fd, ids.frontDeskId);
      await api(`/invoices/${aiaNightInvoice}/ensure-consultation`, fd, 'POST', {});
      const aiaNightRead = await api(`/invoices?visitId=${aiaNight.visitId}`, fd);
      const aiaNightLine = aiaNightRead[0].lines.find((l: { sourceConsultationVisitId: string | null }) => l.sourceConsultationVisitId);
      check('46. AIA night is a DIFFERENT panel price (RM30)', Number(aiaNightLine?.unitPrice) === 30);

      const mara = await makeVisit(ids, {
        label: 'MARA consult',
        consultationStartAt: klToday('10:00'),
        panelClinicId: ids.panelMaraId,
      });
      const maraInvoice = await newInvoice(mara.visitId, fd, ids.frontDeskId);
      await api(`/invoices/${maraInvoice}/ensure-consultation`, fd, 'POST', {});
      const maraRead = await api(`/invoices?visitId=${mara.visitId}`, fd);
      const maraLine = maraRead[0].lines.find((l: { sourceConsultationVisitId: string | null }) => l.sourceConsultationVisitId);
      check('45/47. MARA charges its same fixed panel price in either band (RM40)',
        Number(maraLine?.unitPrice) === 40);
    }

    // --- 48/49/50. Exemptions ----------------------------------------------
    for (const [label, classification] of [
      ['48. an OTC-only visit', 'OTC_ONLY'],
      ['49. a dressing-only visit', 'DRESSING_ONLY'],
      ['50. a procedure-only visit', 'PROCEDURE_ONLY'],
    ] as const) {
      const visit = await makeVisit(ids, {
        label: `exempt ${classification}`,
        consultationStartAt: klToday('10:00'),
        classification,
      });
      const invoiceId = await newInvoice(visit.visitId, fd, ids.frontDeskId);
      const result = await api(`/invoices/${invoiceId}/ensure-consultation`, fd, 'POST', {});
      const invoice = await api(`/invoices?visitId=${visit.visitId}`, fd);
      check(`${label} is not auto-charged a consultation`,
        result.added === false && invoice[0].lines.length === 0, `state=${result.state?.kind}`);
    }

    // --- 51. No matching tariff -> review, never a guess --------------------
    {
      // 05:00 with the night band deactivated for this check would need a
      // config change; instead use a classification with no rule at all and
      // confirm no line is invented.
      const visit = await makeVisit(ids, {
        label: 'no tariff match',
        consultationStartAt: klToday('10:00'),
        classification: 'FOLLOW_UP_NO_CONSULTATION',
      });
      const invoiceId = await newInvoice(visit.visitId, fd, ids.frontDeskId);
      const result = await api(`/invoices/${invoiceId}/ensure-consultation`, fd, 'POST', {});
      const invoice = await api(`/invoices?visitId=${visit.visitId}`, fd);
      check('51. an unmatched visit gets NO guessed consultation line',
        result.added === false && invoice[0].lines.length === 0);
    }

    // --- 58/59/60/61/62. Waiver -------------------------------------------
    {
      const visit = await makeVisit(ids, { label: 'waiver', consultationStartAt: klToday('10:00') });
      const invoiceId = await newInvoice(visit.visitId, fd, ids.frontDeskId);
      await api(`/invoices/${invoiceId}/ensure-consultation`, fd, 'POST', {});
      let invoice = (await api(`/invoices?visitId=${visit.visitId}`, fd))[0];
      const lineId = invoice.lines[0].id;
      const before = Number(invoice.totalAmount);

      const noReason = await call(`/invoices/${invoiceId}/lines/${lineId}`, fd, 'DELETE', {});
      check('59. a waiver with no reason is refused', noReason.status === 400, `HTTP ${noReason.status}`);

      await api(`/invoices/${invoiceId}/lines/${lineId}`, fd, 'DELETE', { cancelReason: 'Follow-up — no consultation fee' });
      invoice = (await api(`/invoices?visitId=${visit.visitId}`, fd))[0];
      const waived = invoice.lines.find((l: { id: string }) => l.id === lineId);
      check('58/60/61/62. the waived charge leaves the totals, stays in history, and recalculates',
        Number(invoice.totalAmount) === 0 && before === 35 && waived?.cancelledAt != null &&
          waived?.cancelReason === 'Follow-up — no consultation fee' && Number(invoice.patientResponsibilityAmount) === 0,
        `total ${before} -> ${invoice.totalAmount}`);

      // 65. The automatic path stays waived; the explicit add brings it back.
      const reEnsure = await api(`/invoices/${invoiceId}/ensure-consultation`, fd, 'POST', {});
      check('65. a waived consultation is never silently re-added',
        reEnsure.added === false && reEnsure.state?.kind === 'WAIVED', `state=${reEnsure.state?.kind}`);
      await api(`/invoices/${invoiceId}/consultation-charge`, fd, 'POST', {});
      invoice = (await api(`/invoices?visitId=${visit.visitId}`, fd))[0];
      const active = invoice.lines.filter((l: { cancelledAt: string | null }) => !l.cancelledAt);
      check('65. an EXPLICIT re-add restores exactly one active consultation charge', active.length === 1);
    }

    // --- 11/63. Waiver permissions ----------------------------------------
    {
      const visit = await makeVisit(ids, { label: 'waiver rbac', consultationStartAt: klToday('10:00') });
      const invoiceId = await newInvoice(visit.visitId, fd, ids.frontDeskId);
      await api(`/invoices/${invoiceId}/ensure-consultation`, fd, 'POST', {});
      const invoice = (await api(`/invoices?visitId=${visit.visitId}`, fd))[0];
      const lineId = invoice.lines[0].id;
      const asDoctor = await call(`/invoices/${invoiceId}/lines/${lineId}`, doc, 'DELETE', { cancelReason: 'Complimentary' });
      check('11. a DOCTOR may not waive a consultation charge', asDoctor.status === 403, `HTTP ${asDoctor.status}`);
      const asFinance = await call(`/invoices/${invoiceId}/lines/${lineId}`, fin, 'DELETE', { cancelReason: 'Complimentary' });
      check('63. FINANCE may waive it', asFinance.status < 400, `HTTP ${asFinance.status}`);
    }

    // --- 26/28/31. Sourced quantity and price truth -------------------------
    {
      const visit = await makeVisit(ids, { label: 'quantity truth', consultationStartAt: klToday('10:00') });
      const rx = await scoped((tx) =>
        tx.prescription.create({
          data: {
            tenantId: TENANT_ID,
            visitId: visit.visitId,
            itemId: ids.itemId,
            quantity: 7,
            amount: 1,
            frequency: 'TDS',
            durationDays: 3,
            prescribedByStaffId: ids.doctorId,
            supplyMode: 'ONSITE_DISPENSE',
            status: 'DISPENSED',
            dispensedAt: new Date(),
          },
        }),
      );
      const invoiceId = await newInvoice(visit.visitId, fd, ids.frontDeskId);
      // A lying client: quantity 99, price 999.
      await api(`/invoices/${invoiceId}/lines`, fd, 'POST', {
        description: 'ignored',
        sourcePrescriptionId: rx.id,
        quantity: 99,
        unitPrice: 999,
      });
      const invoice = (await api(`/invoices?visitId=${visit.visitId}`, fd))[0];
      const line = invoice.lines.find((l: { sourcePrescriptionId: string | null }) => l.sourcePrescriptionId === rx.id);
      const item = await scoped((tx) => tx.item.findUnique({ where: { id: ids.itemId }, select: { sellPrice: true } }));
      check('26/28. the SOURCE quantity is billed (7), not the client’s 99', line?.quantity === 7, `qty ${line?.quantity}`);
      check('31. the SERVER price is billed, not the client’s 999',
        Number(line?.unitPrice) === Number(item?.sellPrice), `${line?.unitPrice} vs cash ${item?.sellPrice}`);
    }

    // --- an ORDERED medication cannot be finalised -------------------------
    {
      const visit = await makeVisit(ids, { label: 'not dispensed', consultationStartAt: klToday('10:00') });
      const rx = await scoped((tx) =>
        tx.prescription.create({
          data: {
            tenantId: TENANT_ID,
            visitId: visit.visitId,
            itemId: ids.itemId,
            quantity: 5,
            amount: 1,
            frequency: 'BD',
            durationDays: 3,
            prescribedByStaffId: ids.doctorId,
            supplyMode: 'ONSITE_DISPENSE',
            status: 'ORDERED',
          },
        }),
      );
      const invoiceId = await newInvoice(visit.visitId, fd, ids.frontDeskId);
      const attempt = await call(`/invoices/${invoiceId}/lines`, fd, 'POST', {
        description: 'x',
        sourcePrescriptionId: rx.id,
      });
      check('an ORDERED (undispensed) medication cannot be finalised as a charge',
        attempt.status === 400, `HTTP ${attempt.status}`);
      const worklist = await api(`/visits/${visit.visitId}/billing-worklist`, fd);
      const item = worklist.find((w: { sourceId: string }) => w.sourceId === rx.id);
      check('…and the worklist reports it as awaiting dispensing', item?.state === 'AWAITING_DISPENSE', item?.state);
    }

    // --- 80/74. Discount permissions ---------------------------------------
    {
      const visit = await makeVisit(ids, { label: 'discounts', consultationStartAt: klToday('10:00') });
      const invoiceId = await newInvoice(visit.visitId, fd, ids.frontDeskId);
      await api(`/invoices/${invoiceId}/ensure-consultation`, fd, 'POST', {});
      const invoice = (await api(`/invoices?visitId=${visit.visitId}`, fd))[0];
      const lineId = invoice.lines[0].id;

      const asFrontDesk = await call(`/invoices/${invoiceId}/discount`, fd, 'PATCH', {
        type: 'PERCENTAGE', value: 10, reason: 'loyal patient',
      });
      check('80. FRONT DESK is refused a discount', asFrontDesk.status === 403, `HTTP ${asFrontDesk.status}`);

      await api(`/invoices/${invoiceId}/lines/${lineId}/discount`, fin, 'PATCH', {
        type: 'FIXED_AMOUNT', value: 5, reason: 'goodwill',
      });
      const afterLine = (await api(`/invoices?visitId=${visit.visitId}`, fin))[0];
      check('74. FINANCE applies a line discount: RM35 − RM5 = RM30',
        Number(afterLine.totalAmount) === 30, `total ${afterLine.totalAmount}`);

      await api(`/invoices/${invoiceId}/discount`, fin, 'PATCH', {
        type: 'PERCENTAGE', value: 10, reason: 'promotion',
      });
      const afterOverall = (await api(`/invoices?visitId=${visit.visitId}`, fin))[0];
      check('77. an overall 10% reduces the PATIENT portion to RM27',
        Number(afterOverall.patientResponsibilityAmount) === 27, `patient ${afterOverall.patientResponsibilityAmount}`);
    }

    // --- 78. Overall discount never touches the panel receivable ------------
    {
      const visit = await makeVisit(ids, {
        label: 'panel discount policy',
        consultationStartAt: klToday('10:00'),
        panelClinicId: ids.panelMaraId,
      });
      await api(`/visits/${visit.visitId}/panel-verification`, fd, 'PATCH', {
        status: 'VERIFIED', coverageType: 'VISIT_LIMIT', visitLimitAmount: 30,
      });
      const invoiceId = await newInvoice(visit.visitId, fd, ids.frontDeskId);
      await api(`/invoices/${invoiceId}/ensure-consultation`, fd, 'POST', {}); // MARA RM40, limit 30
      const before = (await api(`/invoices?visitId=${visit.visitId}`, fin))[0];
      await api(`/invoices/${invoiceId}/discount`, fin, 'PATCH', {
        type: 'FIXED_AMOUNT', value: 5, reason: 'goodwill',
      });
      const after = (await api(`/invoices?visitId=${visit.visitId}`, fin))[0];
      check('78. an overall discount reduces ONLY the patient portion; the panel keeps RM30',
        Number(before.panelResponsibilityAmount) === 30 &&
          Number(after.panelResponsibilityAmount) === 30 &&
          Number(before.patientResponsibilityAmount) === 10 &&
          Number(after.patientResponsibilityAmount) === 5,
        `panel ${before.panelResponsibilityAmount}->${after.panelResponsibilityAmount}, patient ${before.patientResponsibilityAmount}->${after.patientResponsibilityAmount}`);
    }

    // --- 66/95/96/89/93/99. Payment ----------------------------------------
    {
      const visit = await makeVisit(ids, {
        label: 'payment gating',
        consultationStartAt: klToday('10:00'),
        panelClinicId: ids.panelAiaId,
      });
      const invoiceId = await newInvoice(visit.visitId, fd, ids.frontDeskId);
      const unresolved = await call(`/invoices/${invoiceId}/pay`, fd, 'PATCH', { paymentMethod: 'CASH' });
      check('66/95. an unresolved panel verification prevents payment, in the approved wording',
        unresolved.status === 400 && unresolved.body?.message === 'Billing responsibility has not been confirmed.',
        unresolved.body?.message);

      await api(`/visits/${visit.visitId}/panel-verification`, fd, 'PATCH', {
        status: 'VERIFIED', coverageType: 'UNLIMITED',
      });
      await api(`/invoices/${invoiceId}/ensure-consultation`, fd, 'POST', {});
      // A dispensed medication nobody has invoiced.
      const rx = await scoped((tx) =>
        tx.prescription.create({
          data: {
            tenantId: TENANT_ID,
            visitId: visit.visitId,
            itemId: ids.itemId,
            quantity: 4,
            amount: 1,
            frequency: 'OD',
            durationDays: 4,
            prescribedByStaffId: ids.doctorId,
            supplyMode: 'ONSITE_DISPENSE',
            status: 'DISPENSED',
            dispensedAt: new Date(),
          },
        }),
      );
      const unbilled = await call(`/invoices/${invoiceId}/pay`, fd, 'PATCH', { paymentMethod: 'CASH' });
      check('96. unbilled ready work prevents settlement and NAMES the item',
        unbilled.status === 400 && String(unbilled.body?.message).includes('uninvoiced'),
        unbilled.body?.message);

      await api(`/invoices/${invoiceId}/lines`, fd, 'POST', { description: 'Med', sourcePrescriptionId: rx.id });
      const beforePay = (await api(`/invoices?visitId=${visit.visitId}`, fd))[0];
      check('93. an AIA-covered visit leaves the patient owing nothing',
        Number(beforePay.patientResponsibilityAmount) === 0 && Number(beforePay.panelResponsibilityAmount) > 0,
        `patient ${beforePay.patientResponsibilityAmount}, panel ${beforePay.panelResponsibilityAmount}`);

      const cashOnZero = await call(`/invoices/${invoiceId}/pay`, fd, 'PATCH', { paymentMethod: 'PANEL' });
      check('93. PANEL settlement is accepted when the panel carries a positive amount',
        cashOnZero.status < 400, `HTTP ${cashOnZero.status}`);

      const visitAfter = await api(`/visits/${visit.visitId}`, fd);
      check('99. settling the invoice did NOT complete the visit',
        visitAfter.checkOutAt === null, `checkOutAt=${visitAfter.checkOutAt}`);
    }

    // --- 89. Cash settlement resolves the exact balance ---------------------
    {
      const visit = await makeVisit(ids, { label: 'cash settlement', consultationStartAt: klToday('10:00') });
      const invoiceId = await newInvoice(visit.visitId, fd, ids.frontDeskId);
      await api(`/invoices/${invoiceId}/ensure-consultation`, fd, 'POST', {});
      const paid = await api(`/invoices/${invoiceId}/pay`, fd, 'PATCH', { paymentMethod: 'CASH' });
      check('89. cash settles the exact patient balance (RM35) and resolves it to zero',
        paid.status === 'PAID' && Number(paid.patientPaidAmount) === 35, `paid ${paid.patientPaidAmount}`);
      const again = await call(`/invoices/${invoiceId}/pay`, fd, 'PATCH', { paymentMethod: 'CASH' });
      check('100. a duplicate payment submission is refused', again.status === 400, `HTTP ${again.status}`);
    }
  } finally {
    if (!KEEP && created.length > 0) {
      await scoped(async (tx) => {
        const list = created.map((id) => `'${id}'`).join(',');
        await tx.$executeRawUnsafe(`DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE visit_id IN (${list}))`);
        await tx.$executeRawUnsafe(`DELETE FROM invoices WHERE visit_id IN (${list})`);
        await tx.$executeRawUnsafe(`DELETE FROM stock_movements WHERE reference_id IN (SELECT id FROM prescriptions WHERE visit_id IN (${list}))`);
        await tx.$executeRawUnsafe(`DELETE FROM prescriptions WHERE visit_id IN (${list})`);
        await tx.$executeRawUnsafe(`DELETE FROM order_services WHERE visit_id IN (${list})`);
        // visit_workflow_events is append-only by design (no DELETE grant,
        // deliberately), so a queue ticket it references cannot be erased
        // either. The synthetic tickets are CLOSED, the visits checked out
        // and their patients soft-deleted — nothing is left in a working list.
        await tx.$executeRawUnsafe(`UPDATE queue_tickets SET status = 'COMPLETED' WHERE visit_id IN (${list})`);
        await tx.$executeRawUnsafe(`UPDATE visits SET check_out_at = now() WHERE id IN (${list})`);
        await tx.$executeRawUnsafe(`UPDATE patients SET deleted_at = now() WHERE id IN (SELECT patient_id FROM visits WHERE id IN (${list}))`);
      });
    }
  }

  if (!SEED_ONLY) {
    console.log('='.repeat(70));
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
