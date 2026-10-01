import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import {
  DEFAULT_COMPONENT_LIABILITY,
  PayrollComponentLine,
  ageAt,
  computeOvertime,
  computePayslip,
  ordinaryRates,
} from '../src/workforce/payroll-calculation';
import { buildException, ExceptionSeverity } from '../src/workforce/payroll-exception';
import { SEED_PAY_COMPONENTS } from '../src/workforce/pay-component-catalogue';

config({ path: join(__dirname, '..', '.env') });

/**
 * ADMIN PROGRAMME — UAT SEED.
 *
 * Builds one synthetic clinic group with enough real-shaped history that every
 * screen in the five admin modules has something to show and every rule has a
 * case that exercises it. The owner's UAT list, in order:
 *
 *   2 branches · central stock · 3 suppliers · 3 doctors (resident + locum) ·
 *   counter and stock staff · cash / card / QR · 3 panels · a partial claim ·
 *   a rejected-and-re-claimed claim · a paid claim · an unpaid claim ·
 *   a stock transfer · a transfer discrepancy · near-expiry stock ·
 *   negative stock · a slow mover · purchase orders · leave · attendance ·
 *   overtime · an incentive run · a payroll run · a credit note ·
 *   outstanding invoices · closed and unclosed days
 *
 * SYNTHETIC ONLY. Every name is invented, every identifier is in the reserved
 * 000000-00-xxxx form, and every email is on the RFC 2606 `.invalid` TLD which
 * can never route. Nothing here came from, or resembles, a real record.
 *
 *   KUWICK_ADMIN_UAT_SEED=yes \
 *   ADMIN_UAT_RESET_URL=postgresql://<owner>:<pass>@host:5432/<db> \
 *   npx tsx prisma/seed-admin-uat.ts
 *
 * Idempotent by tenant: re-running deletes and rebuilds ITS OWN tenant and
 * touches nothing else. The delete half needs the database OWNER — see
 * RESET_URL below for why the application role cannot do it. On a database
 * where the tenant does not exist yet, DATABASE_URL alone is enough.
 */

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

/**
 * THE URL USED TO CLEAR THE TENANT, which is not the one used to build it.
 *
 * Dropping a whole tenant needs two things the application role deliberately
 * does not have: sight of the rows at all (every table is FORCE ROW LEVEL
 * SECURITY, so a DELETE issued without `app.tenant_id` matches nothing and
 * reports success), and the right to switch off the append-only triggers on
 * payments and stock movements. `DATABASE_URL` is the application role. Run
 * against it, the reset below deleted nothing, said nothing, and the rebuild
 * then failed on the duplicate tenant id — so the "idempotent by tenant"
 * promise in the header was not true. Point this at the database owner and it
 * is.
 */
const RESET_URL = process.env.ADMIN_UAT_RESET_URL ?? process.env.DATABASE_URL;

const TENANT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const DOMAIN = 'admin-uat.kuwick.invalid';
const PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? 'AdminUat!2026';

type Tx = Prisma.TransactionClient;

/**
 * TODAY, AS THE CLINIC HAS IT — not as UTC has it.
 *
 * This read `now.getUTCDate()`, so the world it seeded was dated by UTC while
 * every screen reading it resolves the attendance day through `clinicDateKey`
 * in Asia/Kuala_Lumpur. Malaysia is UTC+8, so from 16:00 UTC onwards the two
 * disagree: the seed wrote its open punches against yesterday, and HR ▸
 * Overview — whose entire job is answering "who is here?" — answered "nobody",
 * correctly, about a day nobody had seeded.
 *
 * It looked like a flaky test. It was a seed and an application disagreeing
 * about what day it is for a third of every day.
 */
const SEED_ZONE = 'Asia/Kuala_Lumpur';

function day(offset: number): Date {
  // The clinic-local date, at UTC midnight — the same shape `workDate` takes
  // everywhere else (`dateOnly(clinicDateKey(...))`). `en-CA` renders
  // YYYY-MM-DD, which is that date key.
  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEED_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return new Date(new Date(`${key}T00:00:00.000Z`).getTime() + offset * 86400000);
}

function at(offset: number, hour: number, minute = 0): Date {
  return new Date(day(offset).getTime() + hour * 3600000 + minute * 60000);
}
function monthStart(offset = 0): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

/**
 * A day guaranteed to sit inside the window the admin screens open on.
 *
 * THE FIXTURE CONTRACT THIS ENFORCES: demo data that a default view must show
 * has to land inside that view's default window, and every operational screen
 * defaults to THIS month.
 *
 * `day(-20)` is a sensible "three weeks ago" for most of a month and lands in
 * the PREVIOUS one for the first three weeks of it — on the 1st, all twenty of
 * them do. The seeded reversal and the unapproved overtime then still exist,
 * but no default view can see them, and a spec asserting on that view fails on
 * the calendar rather than on the code it is testing. That is exactly what
 * happened when the month turned over from August to September 2026.
 *
 * `preferred` is how far back the data would ideally sit; when the month is too
 * young to hold it, the date compresses toward today rather than falling out of
 * the window. It never returns a future date.
 */
function dayInCurrentMonth(preferred: number): Date {
  // Days available strictly before today, within this month. Zero on the 1st.
  const elapsed = new Date().getUTCDate() - 1;
  return day(Math.max(preferred, -elapsed));
}

let sequence = 0;
const nextNumber = (prefix: string) => `${prefix}-${String(++sequence).padStart(6, '0')}`;

async function withTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, TENANT_ID);
      return fn(tx);
    },
    { timeout: 120_000 },
  );
}

async function main() {
  if (process.env.KUWICK_ADMIN_UAT_SEED !== 'yes') {
    throw new Error('Refusing to run without KUWICK_ADMIN_UAT_SEED=yes — this seed writes a whole tenant.');
  }

  // `--verify-only` re-checks the arithmetic of a tenant that is already
  // seeded, without rebuilding it. Useful after a UAT session has moved money
  // around by hand, and it is how the check below is itself tested.
  if (process.argv.includes('--verify-only')) {
    await verify();
    console.log('Admin UAT tenant reconciles.');
    return;
  }

  console.log('Admin UAT seed — rebuilding the synthetic tenant…');
  await reset();

  const ids = await withTenant(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { id: TENANT_ID, name: 'Klinik Contoh (UAT)' },
    });

    // --- Branches ---------------------------------------------------------
    const central = await tx.clinic.create({
      data: { tenantId: tenant.id, name: 'Contoh Central', timezone: 'Asia/Kuala_Lumpur' },
    });
    const branch = await tx.clinic.create({
      data: { tenantId: tenant.id, name: 'Contoh Bandar', timezone: 'Asia/Kuala_Lumpur' },
    });

    // --- People -----------------------------------------------------------
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const people = [
      { key: 'owner', name: 'Dr Aisyah Rahman', role: 'OWNER_ADMIN' as const, clinic: central.id, doctor: true },
      { key: 'locum', name: 'Dr Faiz Ismail', role: 'DOCTOR_LOCUM' as const, clinic: branch.id, doctor: true },
      { key: 'resident', name: 'Dr Meera Kaur', role: 'DOCTOR_RESIDENT' as const, clinic: central.id, doctor: true },
      { key: 'counter', name: 'Nurul Hidayah', role: 'FRONT_DESK_CLINICAL_STAFF' as const, clinic: central.id, doctor: false },
      { key: 'counter2', name: 'Siti Zaleha', role: 'FRONT_DESK_CLINICAL_STAFF' as const, clinic: branch.id, doctor: false },
      { key: 'stock', name: 'Hafiz Osman', role: 'STOCK_STAFF' as const, clinic: central.id, doctor: false },
      // Central is her HOME branch — where she is employed and paid. Her
      // finance MODULE reach is a permission question, not this column: a
      // null here put her in NO branch's payroll run, silently, every month.
      { key: 'finance', name: 'Chandra Devi', role: 'FINANCE_STAFF' as const, clinic: central.id, doctor: false },
      { key: 'panel', name: 'Wan Azman', role: 'PANEL_STAFF' as const, clinic: central.id, doctor: false },
      /*
       * FOUR MORE, SO THE REGISTER CAN BE JUDGED.
       *
       * Eight people with one allowance and one overtime row between them is
       * not a payroll anybody can look at and say "yes, I understand this" —
       * every column was empty for almost everybody, so the register proved
       * nothing about whether it reads well when it is full. These four carry
       * the earnings a real clinic has and Kuwick had never shown together:
       * unpaid leave, a procedure incentive, a reimbursed claim, commission
       * and a bonus.
       *
       * Synthetic, like everything else in this file: invented names,
       * `.invalid` accounts, invented figures.
       */
      /*
       * CLINIC_MANAGER, not HR_STAFF. UAT found her unable to press Approve on
       * a leave request while this file's own console output described her as
       * approving leave, claims and overtime — the seed contradicted its own
       * documentation. HR_STAFF is a records clerk and approves nothing, which
       * is correct for a clerk and wrong for her.
       */
      { key: 'manager', name: 'Rohana Yusof', role: 'CLINIC_MANAGER' as const, clinic: central.id, doctor: false },
      { key: 'nurse', name: 'Puteri Balqis', role: 'FRONT_DESK_CLINICAL_STAFF' as const, clinic: central.id, doctor: false },
      { key: 'pharm', name: 'Lim Wei Chen', role: 'STOCK_STAFF' as const, clinic: branch.id, doctor: false },
      { key: 'accounts', name: 'Kavitha Menon', role: 'FINANCE_STAFF' as const, clinic: branch.id, doctor: false },
    ];

    const staff: Record<string, string> = {};
    for (const person of people) {
      const user = await tx.user.create({
        data: { tenantId: tenant.id, email: `${person.key}@${DOMAIN}`, passwordHash, status: 'active' },
      });
      const row = await tx.staff.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          role: person.role,
          fullName: person.name,
          clinicId: person.clinic,
          staffNumber: `S-${person.key.toUpperCase()}`,
          ...(person.doctor
            ? {
                professionalType: 'MEDICAL_DOCTOR' as const,
                professionalActive: true,
                medicalRegistrationNo: `MMC-${String(9000 + Object.keys(staff).length)}`,
                medicalRegistrationNoNormalised: `MMC${String(9000 + Object.keys(staff).length)}`,
                canSignClinicalNotes: true,
                professionalVerifiedAt: day(-400),
                clinicalSigningEnabledAt: day(-400),
              }
            : {}),
        },
      });
      staff[person.key] = row.id;
    }
    // The owner verifies the other clinicians — a self-consistent credential trail.
    await tx.staff.updateMany({
      where: { tenantId: tenant.id, professionalActive: true },
      data: { professionalVerifiedByStaffId: staff.owner, clinicalSigningEnabledByStaffId: staff.owner },
    });

    // --- Tax --------------------------------------------------------------
    const sst = await tx.taxCode.create({
      data: { tenantId: tenant.id, code: 'SST-6', name: 'Service tax 6%', treatment: 'STANDARD_RATED' },
    });
    await tx.taxRate.create({
      data: { tenantId: tenant.id, taxCodeId: sst.id, ratePercent: '6.000', effectiveFrom: day(-800) },
    });
    const exempt = await tx.taxCode.create({
      data: { tenantId: tenant.id, code: 'EXEMPT-MED', name: 'Exempt — dispensed medicines', treatment: 'EXEMPT' },
    });

    // --- Suppliers --------------------------------------------------------
    const suppliers = await Promise.all(
      [
        // Terms out of prose and into fields. Three shapes on purpose: a
        // supplier with everything recorded, one with terms but no credit
        // limit, and one where NOTHING was recorded — so the payables screen
        // demonstrates what it does when a term is unknown rather than hiding
        // the case.
        {
          name: 'Contoh Pharma Supplies',
          contactName: 'Encik Rosli',
          phone: '03-1111 0001',
          paymentTermDays: 30,
          creditLimitAmount: 12000,
          deliverySlaDays: 7,
          accountReference: 'CPS-KLK-0041',
        },
        {
          name: 'Bandar Medical Trading',
          contactName: 'Ms Lee',
          phone: '03-1111 0002',
          paymentTermDays: 60,
          deliverySlaDays: 14,
        },
        { name: 'Sinar Consumables', contactName: 'Puan Zainab', phone: '03-1111 0003' },
      ].map((supplier) => tx.supplier.create({ data: { tenantId: tenant.id, ...supplier } })),
    );

    // --- Catalogue --------------------------------------------------------
    const services = await Promise.all(
      [
        { name: 'General Consultation', price: 35, category: 'Consultation', taxCodeId: sst.id },
        { name: 'Wound Dressing', price: 45, category: 'Minor Procedure', taxCodeId: sst.id },
        { name: 'Suturing (minor)', price: 180, category: 'Minor Procedure', taxCodeId: sst.id },
        { name: 'Antenatal Review', price: 90, category: 'Maternal', taxCodeId: sst.id },
        { name: 'NCD Review', price: 60, category: 'Chronic Care', taxCodeId: sst.id },
        { name: 'Weight Management Review', price: 120, category: 'Weight Management', taxCodeId: sst.id },
      ].map((service, index) =>
        tx.serviceCatalog.create({
          data: {
            tenantId: tenant.id,
            name: service.name,
            price: service.price,
            category: service.category,
            taxCodeId: service.taxCodeId,
            durationMinutesDefault: 15 + index * 5,
          },
        }),
      ),
    );

    const items = await Promise.all(
      [
        { name: 'Amoxicillin 500mg', code: 'AMOX500', category: 'Antibiotic', sellPrice: 12, cost: 4.5, unitOfMeasure: 'Strip' },
        { name: 'Metformin 500mg', code: 'MET500', category: 'Antidiabetic', sellPrice: 9, cost: 3.2, unitOfMeasure: 'Strip' },
        { name: 'Amlodipine 5mg', code: 'AML5', category: 'Antihypertensive', sellPrice: 11, cost: 3.8, unitOfMeasure: 'Strip' },
        { name: 'Semaglutide 0.25mg pen', code: 'SEMA025', category: 'Weight Management', sellPrice: 460, cost: 320, unitOfMeasure: 'Pen' },
        { name: 'Folic Acid 5mg', code: 'FOL5', category: 'Supplement', sellPrice: 6, cost: 1.6, unitOfMeasure: 'Strip' },
        { name: 'Dressing Pack', code: 'DRESS1', category: 'Consumable', sellPrice: 18, cost: 7.4, unitOfMeasure: 'Pack' },
        { name: 'Paracetamol 500mg', code: 'PARA500', category: 'Analgesic', sellPrice: 5, cost: 1.2, unitOfMeasure: 'Strip' },
        { name: 'Discontinued Cough Syrup', code: 'OLDSYR', category: 'Respiratory', sellPrice: 22, cost: 9.5, unitOfMeasure: 'Bottle' },
      ].map((item) =>
        tx.item.create({
          data: {
            tenantId: tenant.id,
            ...item,
            taxCodeId: exempt.id,
            quantityPerStockUnit: 1,
            dispensedWholeAt: day(-500),
          },
        }),
      ),
    );
    const itemBy = Object.fromEntries(items.map((item) => [item.code!, item]));

    // --- Panels -----------------------------------------------------------
    const panels = await Promise.all(
      [
        {
          name: 'MediCover TPA (Synthetic)',
          code: 'MEDICOVER',
          payerName: 'MediCover Administrators Sdn Bhd',
          portalUrl: 'https://portal.medicover.invalid/claims',
          submissionMethod: 'PORTAL' as const,
          // A RANGE TERM with a WITHHELD fee — the commonest shape in the
          // clinic's real book: chase at 30, genuinely late at 45, and the
          // panel keeps its 8% out of what it pays.
          paymentTermDays: 30,
          paymentTermMaxDays: 45,
          paymentTermUnit: 'CALENDAR_DAYS' as const,
          paymentTermAnchor: 'SUBMISSION_DATE' as const,
          resubmissionWindowDays: 60,
          claimFeeType: 'PERCENT' as const,
          claimFeeValue: 8,
          feeTreatment: 'WITHHELD_FROM_CLAIM' as const,
          limitAmount: 150,
          requiresItemisation: true,
          resubmitAsNewClaim: true,
          documentRequirements: ['Signed consultation summary', 'Itemised bill', 'Patient IC copy'],
          contactName: 'Claims Desk',
          contactPhone: '03-2222 0001',
        },
        {
          name: 'Sejahtera Care (Synthetic)',
          code: 'SEJAHTERA',
          payerName: 'Sejahtera Insurance Berhad',
          portalUrl: 'https://portal.sejahtera.invalid',
          submissionMethod: 'EMAIL' as const,
          // WORKING DAYS counted from the INVOICE date, and — deliberately —
          // an UNCONFIGURED fee treatment. This mirrors the one real panel in
          // the clinic's workbook whose evidence is genuinely insufficient: a
          // single paid fee-bearing claim, which banked at the full amount. The
          // owner's decision of 2026-08-31 defaults existing panels to
          // WITHHELD, and explicitly isolates a panel like this one instead of
          // inferring a rule from one row.
          //
          // It is in the UAT set because it is the one thing a demo usually
          // hides: what the system does when it does not know. The receivable
          // is computed WITHOUT the fee, the claim is marked unresolved, and
          // both the configuration screen and the reconciliation say so.
          feeTreatment: 'UNCONFIGURED' as const,
          paymentTermDays: 30,
          paymentTermUnit: 'WORKING_DAYS' as const,
          paymentTermAnchor: 'INVOICE_DATE' as const,
          resubmissionWindowDays: 60,
          claimFeeType: 'AMOUNT' as const,
          claimFeeValue: 5,
          limitAmount: 200,
          requiresItemisation: false,
          resubmitAsNewClaim: true,
          documentRequirements: ['Referral letter where applicable'],
          contactName: 'Ms Farah',
          contactPhone: '03-2222 0002',
        },
        {
          name: 'Kilang Sejati Staff Panel (Synthetic)',
          code: 'KILANG',
          payerName: 'Kilang Sejati Sdn Bhd',
          submissionMethod: 'COURIER' as const,
          // A plain calendar term and no fee at all — NO_FEE, which is a
          // different state from UNCONFIGURED: there is nothing to establish
          // here, so nothing is flagged. The re-claim window is left unset,
          // which is its own honest state: no deadline is counted down.
          feeTreatment: 'NO_FEE' as const,
          paymentTermDays: 60,
          paymentTermUnit: 'CALENDAR_DAYS' as const,
          limitAmount: 100,
          resubmitAsNewClaim: false,
          documentRequirements: ['Company authorisation slip'],
        },
      ].map((panel) => tx.panelClinic.create({ data: { tenantId: tenant.id, ...panel } })),
    );

    return { tenant, central, branch, staff, services, items: itemBy, panels, suppliers, sst, exempt };
  });

  await seedStock(ids);
  await seedClinicalAndFinance(ids);
  await seedPanelClaims(ids);
  await seedWorkforce(ids);
  await seedAnalytics(ids);

  await verify();

  console.log('\nAdmin UAT seed complete.');
  console.log(`  tenant   : Klinik Contoh (UAT)`);
  console.log(`  branches : Contoh Central, Contoh Bandar`);
  console.log(`  sign in  : owner@${DOMAIN} / ${PASSWORD}`);
  console.log(`             finance@${DOMAIN}, stock@${DOMAIN}, panel@${DOMAIN} (same password)`);
}

/**
 * THE SEED CHECKS ITS OWN ARITHMETIC BEFORE IT CLAIMS TO BE DONE.
 *
 * A demo dataset whose totals do not reconcile is worse than no dataset: it
 * teaches the reviewer to distrust the screens, and it hides real regressions
 * behind numbers nobody trusts anyway. §7 says every financial aggregate must
 * be reproducible from the underlying records, so this asserts exactly that
 * over the rows just written, and refuses to report success otherwise.
 *
 * These are the same invariants `financial-invariants.ts` and `stock-ledger.ts`
 * enforce at runtime — restated here against the database rather than against
 * a unit-test fixture, because a fixture cannot catch a seed that lies.
 */
async function verify() {
  const problems: string[] = [];
  await withTenant(async (tx) => {
    // 1. STOCK: every level equals the sum of its own movements. This is the
    //    whole point of a ledger — "current stock is DERIVED", not typed in.
    const drift = await tx.$queryRaw<{ clinic_id: string; item_id: string; on_hand: number; ledger: number }[]>`
      SELECT sl.clinic_id, sl.item_id, sl.quantity_on_hand::int AS on_hand,
             COALESCE(SUM(sm.quantity_delta), 0)::int AS ledger
      FROM stock_levels sl
      LEFT JOIN stock_movements sm
        ON sm.tenant_id = sl.tenant_id AND sm.clinic_id = sl.clinic_id AND sm.item_id = sl.item_id
      WHERE sl.tenant_id = ${TENANT_ID}
      GROUP BY sl.clinic_id, sl.item_id, sl.quantity_on_hand
      HAVING sl.quantity_on_hand <> COALESCE(SUM(sm.quantity_delta), 0)`;
    for (const row of drift) {
      problems.push(`stock level ${row.item_id} @ ${row.clinic_id}: on hand ${row.on_hand}, ledger ${row.ledger}`);
    }

    // 2. CLAIMS: a claim's receivable is claimed ± the panel's fee, in the
    //    direction that panel's contract says (G-1). Once adjudicated, approved
    //    + rejected + written off must land on it — a panel cannot approve more
    //    than was asked for, or reject more.
    //
    //    A claim whose fee direction is unset carries its fee in NEITHER
    //    direction, which is exactly what `computeClaimBalance` does, so the
    //    seed and the engine agree by construction rather than by coincidence.
    const claims = await tx.claimBatchLine.findMany({
      where: { tenantId: TENANT_ID },
      select: {
        panelClaimNo: true, claimedAmount: true, feeAmount: true, feeTreatment: true, approvedAmount: true,
        rejectedAmount: true, writtenOffAmount: true, paidAmount: true, adjudicatedAt: true,
      },
    });
    for (const line of claims) {
      const feeSign =
        line.feeTreatment === 'ADDED_TO_RECEIVABLE' ? 1 : line.feeTreatment === 'WITHHELD_FROM_CLAIM' ? -1 : 0;
      const receivable = Number(line.claimedAmount) + feeSign * Number(line.feeAmount);
      const label = line.panelClaimNo ?? '(unsubmitted)';
      if (!line.adjudicatedAt) continue;
      const settled = Number(line.approvedAmount ?? 0) + Number(line.rejectedAmount ?? 0) + Number(line.writtenOffAmount ?? 0);
      /**
       * A PANEL THAT DID NOT APPLY ITS OWN FEE.
       *
       * The identity above assumes the panel adjudicated against the fee rule
       * we hold for them. The real claim workbook contains payments where they
       * did not — two of 2,640, which the owner asked to have investigated
       * rather than averaged away (D-112). On those, adjudication lands on the
       * CLAIMED amount instead of the receivable, and that divergence is the
       * finding, not an error. It is allowed here for exactly one shape — a
       * withheld fee that was not taken — and nothing else moves.
       */
      const feeNotTaken =
        line.feeTreatment === 'WITHHELD_FROM_CLAIM' &&
        Math.abs(settled - Number(line.claimedAmount)) <= 0.005;
      if (Math.abs(settled - receivable) > 0.005 && !feeNotTaken) {
        problems.push(`claim ${label}: approved+rejected+written-off ${settled.toFixed(2)} != receivable ${receivable.toFixed(2)}`);
      }
      if (Number(line.paidAmount ?? 0) > Number(line.approvedAmount ?? 0) + 0.005) {
        problems.push(`claim ${label}: paid ${Number(line.paidAmount).toFixed(2)} exceeds approved ${Number(line.approvedAmount ?? 0).toFixed(2)}`);
      }
    }

    // 2b. PAYABLES: what is owed on a supplier invoice is the invoice minus the
    //     payments ALLOCATED to it — never a typed column. Nothing may be
    //     overpaid, and a PAID status must be backed by allocations that
    //     actually cover it. This is the invariant the clinic's own payable
    //     workbook fails: its roll-up sums the payment-DATE column.
    const supplierInvoices = await tx.supplierInvoice.findMany({
      where: { tenantId: TENANT_ID },
      select: {
        invoiceNumber: true, totalAmount: true, status: true, dueDate: true,
        supplier: { select: { name: true, paymentTermDays: true } },
        allocations: { select: { amount: true } },
      },
    });
    for (const invoice of supplierInvoices) {
      const allocated = invoice.allocations.reduce((sum, a) => sum + Number(a.amount), 0);
      const total = Number(invoice.totalAmount);
      if (allocated - total > 0.005) {
        problems.push(`supplier invoice ${invoice.invoiceNumber}: allocated ${allocated.toFixed(2)} exceeds ${total.toFixed(2)}`);
      }
      if (invoice.status === 'PAID' && total - allocated > 0.005) {
        problems.push(`supplier invoice ${invoice.invoiceNumber}: marked PAID with only ${allocated.toFixed(2)} of ${total.toFixed(2)} allocated`);
      }
      // A due date only exists where a term does. The reverse is not asserted:
      // a due date may be entered by hand.
      if (invoice.dueDate !== null && invoice.supplier.paymentTermDays === null) {
        problems.push(`supplier invoice ${invoice.invoiceNumber}: has a due date but ${invoice.supplier.name} has no payment term`);
      }
    }
    const supplierPayments = await tx.supplierPayment.findMany({
      where: { tenantId: TENANT_ID },
      select: { reference: true, amount: true, allocations: { select: { amount: true } } },
    });
    for (const payment of supplierPayments) {
      const allocated = payment.allocations.reduce((sum, a) => sum + Number(a.amount), 0);
      if (Math.abs(allocated - Number(payment.amount)) > 0.005) {
        problems.push(`supplier payment ${payment.reference}: allocated ${allocated.toFixed(2)} != paid ${Number(payment.amount).toFixed(2)}`);
      }
    }

    // 3. REMITTANCES: net = gross - withheld, and what was allocated to claims
    //    cannot exceed what actually arrived.
    const remittances = await tx.panelRemittance.findMany({
      where: { tenantId: TENANT_ID },
      select: { remittanceRef: true, grossAmount: true, withheldAmount: true, netAmount: true, allocations: { select: { amount: true } } },
    });
    for (const r of remittances) {
      const net = Number(r.grossAmount) - Number(r.withheldAmount);
      if (Math.abs(net - Number(r.netAmount)) > 0.005) {
        problems.push(`remittance ${r.remittanceRef}: net ${Number(r.netAmount).toFixed(2)} != gross - withheld ${net.toFixed(2)}`);
      }
      const allocated = r.allocations.reduce((sum, a) => sum + Number(a.amount), 0);
      if (allocated - Number(r.netAmount) > 0.005) {
        problems.push(`remittance ${r.remittanceRef}: allocated ${allocated.toFixed(2)} exceeds net ${Number(r.netAmount).toFixed(2)}`);
      }
    }

    // 4. INVOICES: patient + panel responsibility must account for the whole
    //    invoice. A split that does not add up is a receivable nobody owns.
    const invoices = await tx.invoice.findMany({
      where: { tenantId: TENANT_ID },
      select: { invoiceNumber: true, totalAmount: true, patientResponsibilityAmount: true, panelResponsibilityAmount: true },
    });
    for (const inv of invoices) {
      if (inv.patientResponsibilityAmount === null && inv.panelResponsibilityAmount === null) continue;
      const split = Number(inv.patientResponsibilityAmount ?? 0) + Number(inv.panelResponsibilityAmount ?? 0);
      if (Math.abs(split - Number(inv.totalAmount)) > 0.005) {
        problems.push(`invoice ${inv.invoiceNumber}: patient+panel ${split.toFixed(2)} != total ${Number(inv.totalAmount).toFixed(2)}`);
      }
    }

    // 5. PAYROLL: statutory figures must match what the rule set can support.
    //
    //    The three states mean three different things, and this check used to
    //    treat two of them as one:
    //
    //      NOT_CONFIGURED  no rule set covers the period. A line carrying an
    //                      EPF number is a FABRICATED figure.
    //      PROVISIONAL     a rule set exists but nobody has verified it against
    //                      the authority's published schedule. Figures ARE
    //                      computed — that is what the schema says the state
    //                      means — but the run must never be APPROVED.
    //      CONFIGURED      verified. Figures computed, run approvable.
    const runs = await tx.payrollRun.findMany({
      where: { tenantId: TENANT_ID },
      select: {
        id: true, period: true, status: true, statutoryStatus: true, exceptions: true,
        lines: {
          select: {
            epfEmployee: true, socsoEmployee: true, eisEmployee: true, pcb: true,
            basicSalary: true, unpaidLeaveDeduction: true, allowances: true,
            overtimePay: true, incentives: true, bonus: true, grossPay: true,
            breakdown: true, staff: { select: { fullName: true } },
          },
        },
      },
    });
    for (const run of runs) {
      const label = run.period.toISOString().slice(0, 7);

      /*
       * 5z. EVERY COMPONENT IS IN A COLUMN, not only in gross.
       *
       * The run's stored totals reconciled perfectly while three employees'
       * allowance, incentive and bonus sat in NO column: the seed wrote the
       * columns from a hand-kept list of person keys while the payslip was
       * priced from a `lines` array, and adding an employee to one and not
       * the other lost the decomposition silently. Gross was right, so every
       * total-level check passed — and the register showed the money as an
       * unexplained residual under "Claims & other".
       *
       * This is the check that catches it: the components the payslip was
       * priced from must equal the columns the line carries. Anything left
       * over is genuinely "other" — a reimbursed claim, a locum fee — and is
       * allowed, but it has to come from a component that belongs there.
       */
      const OTHER = new Set(['CLAIM_REIMBURSEMENT', 'LOCUM_FEE', 'DIRECTOR_FEE']);
      for (const line of run.lines) {
        const parts = ((line.breakdown as { components?: { code: string; amount: number }[] } | null)?.components) ?? [];
        if (parts.length === 0) continue;
        const priced = (codes: string[]) =>
          Number(parts.filter((c) => codes.includes(c.code)).reduce((t, c) => t + Number(c.amount), 0).toFixed(2));
        const columns: [string, number, number][] = [
          ['allowances', Number(line.allowances), priced(['ALLOWANCE', 'ATTENDANCE_ALLOWANCE', 'MILEAGE'])],
          ['overtime', Number(line.overtimePay), priced(['OVERTIME'])],
          ['incentives', Number(line.incentives), priced(['INCENTIVE', 'COMMISSION'])],
          ['bonus', Number(line.bonus), priced(['BONUS'])],
          ['unpaid leave', Number(line.unpaidLeaveDeduction), priced(['UNPAID_LEAVE'])],
        ];
        for (const [name, column, component] of columns) {
          if (Math.abs(column - component) > 0.005) {
            problems.push(
              `payroll ${label}: ${line.staff.fullName} was priced ${component.toFixed(2)} of ${name} but the ` +
                `${name} column says ${column.toFixed(2)} — the difference is invisible on the register`,
            );
          }
        }
        const residual = Number(
          (
            Number(line.grossPay) -
            (Number(line.basicSalary) - Number(line.unpaidLeaveDeduction) + Number(line.allowances) +
              Number(line.overtimePay) + Number(line.incentives) + Number(line.bonus))
          ).toFixed(2),
        );
        const other = priced([...OTHER]);
        if (Math.abs(residual - other) > 0.005) {
          problems.push(
            `payroll ${label}: ${line.staff.fullName} leaves ${residual.toFixed(2)} unexplained after every column, ` +
              `but only ${other.toFixed(2)} was priced as a claim or fee`,
          );
        }
      }

      // 5a. EVERY BLOCKING EXCEPTION EXISTS AS A ROW, not only in the JSON blob.
      //
      // The blob is legacy compatibility state and holds only blockers; the
      // ROWS are what the approval gate, the banner and the exception centre
      // all read, and they also carry warnings the blob never had. So the
      // invariant is not equality — it is that every blocker in the blob is
      // standing as a row.
      //
      // A run carrying five unpayable people in the blob and no rows is a run
      // the Approve button will happily lock, which is exactly the failure
      // this fixture exists to make visible: it must never be the fixture's
      // own state. Checked rather than trusted, because the seed writes both
      // and nothing else would notice if it stopped writing one.
      const blob = Array.isArray(run.exceptions) ? (run.exceptions as unknown[]) : [];
      const blockingRows = await tx.payrollException.count({
        where: { payrollRunId: run.id, severity: 'BLOCKING' },
      });
      if (blockingRows !== blob.length) {
        problems.push(`payroll ${label}: ${blob.length} blocking exception(s) in the blob but ${blockingRows} blocking row(s) — the approval gate reads the rows`);
      }

      if (run.statutoryStatus === 'PROVISIONAL' && (run.status === 'APPROVED' || run.status === 'PAID')) {
        problems.push(`payroll ${label}: approved against a rule set nobody has verified`);
        continue;
      }
      if (run.statutoryStatus !== 'NOT_CONFIGURED') continue;
      const fabricated = run.lines.filter(
        (l) => l.epfEmployee !== null || l.socsoEmployee !== null || l.eisEmployee !== null || l.pcb !== null,
      );
      if (fabricated.length > 0) {
        problems.push(`payroll ${label}: ${fabricated.length} line(s) carry statutory figures while no rule set covers the period`);
      }
    }

    // 6. DAY END: variance is counted minus expected, never a typed-in number.
    const closings = await tx.dayEndClosing.findMany({
      where: { tenantId: TENANT_ID },
      select: { businessDate: true, expectedCash: true, countedCash: true, varianceAmount: true },
    });
    for (const c of closings) {
      if (c.countedCash === null) continue;
      const variance = Number(c.countedCash) - Number(c.expectedCash);
      if (Math.abs(variance - Number(c.varianceAmount ?? 0)) > 0.005) {
        problems.push(`day end ${c.businessDate.toISOString().slice(0, 10)}: variance ${Number(c.varianceAmount ?? 0).toFixed(2)} != counted - expected ${variance.toFixed(2)}`);
      }
    }

    // 7. TODAY IS AN OPEN DAY WITH REAL TAKINGS IN EVERY BUCKET.
    //
    // The review board showed an almost-empty closing screen, and the cause was
    // that every seeded trading day was in the past and already closed. This
    // check makes that impossible to reintroduce silently: it re-derives the
    // drawer the way `DayEndService.expectedFor` does — payments, not invoices;
    // refunds NETTED against their own bucket; PANEL excluded because no money
    // crossed the counter — and fails the seed if the day is empty, if a bucket
    // is missing, if the refund is not netted, or if the day has been closed.
    const central = await tx.clinic.findFirst({ where: { tenantId: TENANT_ID, name: 'Contoh Central' }, select: { id: true } });
    if (!central) {
      problems.push('day end today: Contoh Central not found');
    } else {
      const start = day(0);
      const end = day(1);
      const todaysPayments = await tx.payment.findMany({
        where: { clinicId: central.id, receivedAt: { gte: start, lt: end }, reversedAt: null },
        select: { kind: true, tender: true, amount: true },
      });
      const bucket = { CASH: 0, CARD: 0, QR: 0, OTHER: 0 };
      let refunds = 0;
      for (const payment of todaysPayments) {
        if (payment.tender === 'PANEL') continue;
        const key = payment.tender === 'CASH' ? 'CASH' : payment.tender === 'CARD' ? 'CARD' : payment.tender === 'QR' ? 'QR' : 'OTHER';
        const signed = (payment.kind === 'REFUND' ? -1 : 1) * Number(payment.amount);
        bucket[key] += signed;
        if (payment.kind === 'REFUND') refunds += Number(payment.amount);
      }
      for (const [key, value] of Object.entries(bucket)) {
        if (value <= 0) problems.push(`day end today: expected ${key} is ${value.toFixed(2)} — the closing screen needs takings in every bucket`);
      }
      if (refunds <= 0) problems.push('day end today: no refund today, so the netting rule is untested');
      const alreadyClosed = await tx.dayEndClosing.findFirst({
        where: { tenantId: TENANT_ID, clinicId: central.id, businessDate: start },
        select: { status: true },
      });
      if (alreadyClosed) {
        problems.push(`day end today: a closing already exists (${alreadyClosed.status}) — today must be OPEN for the owner to count and close it`);
      }
      const panelToday = await tx.invoice.count({
        where: { visit: { clinicId: central.id }, createdAt: { gte: start, lt: end }, panelResponsibilityAmount: { gt: 0 } },
      });
      if (panelToday === 0) {
        problems.push('day end today: no panel invoice, so "billed today but not in the drawer" is untested');
      }
    }
  });

  if (problems.length > 0) {
    console.error('\nSeed wrote data that does not reconcile:');
    for (const problem of problems) console.error(`  - ${problem}`);
    throw new Error(`${problems.length} seed invariant(s) failed`);
  }
  console.log('  invariants: stock ledger, claim adjudication, supplier payables, remittances, invoice split, payroll, day end (closed + today OPEN) — all reconcile');
}

/** Deletes this tenant only, in dependency order. */
async function reset() {
  const order = [
    'marketing_dispatches', 'marketing_templates', 'marketing_audiences',
    'programme_enrolments', 'clinic_programmes', 'segment_mapping_rules', 'business_segments',
    // Stage 1 + 2. Children of the run first, then the run; the employer is
    // deleted after `employee_profiles`, which points at it.
    'payroll_snapshots', 'payroll_exceptions',
    // P1. Payment lines point at their batch, the batch and the submissions at
    // the run — all three before `payroll_runs`.
    'payroll_payment_lines', 'payroll_payment_batches', 'payroll_statutory_submissions',
    // Batch 5. An acknowledgement points at the tenant and the staff member
    // who gave it, so it goes before `staff`; nothing points at it.
    'payroll_warning_acknowledgements',
    // Stage 2.5. Claims point AT payroll inputs, so the claim's children and
    // the claims themselves go before the inputs — otherwise the second run of
    // this seed fails on `staff_claims.payroll_input_entry_id`, and only then.
    'staff_claim_events', 'staff_claim_attachments', 'staff_claims', 'claim_policies', 'locum_sessions',
    // Approvals point AT the run, so they go before it; the tenant-level
    // approval rule points at nothing but the tenant.
    'payroll_run_approvals', 'payroll_approval_policies',
    'payroll_adjustments', 'payroll_lines', 'payroll_runs', 'payroll_input_entries', 'statutory_rule_sets',
    'employee_recurring_items', 'employee_ytd', 'employee_salaries',
    // TP1/TP3 point at staff and the legal employer; the dated classification
    // versions and the employer-selected contribution bases at staff. All
    // before `legal_employers` and the staff rows.
    'employee_tp1_entries', 'employee_tp3_records', 'employee_statutory_classifications',
    'employee_contribution_bases',
    'incentive_results', 'incentive_runs', 'incentive_rules',
    'staff_benefit_usages', 'staff_benefit_members', 'staff_benefit_accounts',
    'leave_balances', 'leave_policy_entitlements', 'leave_policies',
    // Correction requests point at the attendance record they ask to change,
    // so they go first; the policy points only at the clinic and the person who
    // last edited it, so it can go anywhere before `staff`.
    // Punches hang off the record they belong to and go before it, even
    // though the foreign key cascades: this list is read as the order the
    // world comes apart in, and a child missing from it reads as an
    // oversight rather than a cascade somebody verified.
    'attendance_punches',
    'attendance_correction_requests', 'attendance_records', 'attendance_policies', 'employee_profiles',
    // The clinic's job titles, pointed at by `employee_profiles.job_title_id` (SET NULL), so after the profiles.
    'job_titles',
    // AFTER the profiles that reference them, BEFORE the staff that authored
    // them.
    // The employer's dated statutory profile before the employer it points at.
    'payroll_policies', 'legal_employer_statutory_profiles', 'legal_employers', 'pay_components',
    'panel_remittance_allocations', 'panel_remittances', 'claim_events',
    'credit_note_lines', 'credit_notes', 'payments', 'day_end_closings',
    // Lines first, then the import batches they point at, then the claim
    // batches. Both parents are reachable from a line, so both come after it.
    'claim_batch_lines', 'claim_import_batches', 'claim_batches',
    'stock_take_lines', 'stock_take_assignments', 'stock_takes',
    'stock_transfer_lines', 'stock_transfers', 'procurement_budgets',
    'goods_received_note_lines', 'goods_received_notes', 'purchase_order_lines', 'purchase_orders',
    'procurement_requests', 'stock_movements', 'stock_batches', 'stock_levels',
    'label_prints', 'prescriptions', 'invoice_lines', 'invoices',
    'diagnoses', 'order_services', 'clinical_note_revisions', 'clinical_notes',
    'visit_observation_revisions', 'visit_observations', 'visit_attachments', 'documents',
    'visit_workflow_events', 'queue_tickets', 'visits',
    'appointment_form_answers', 'appointment_events', 'appointment_communications', 'appointments',
    'waitlist_entries', 'appointment_series', 'provider_shifts', 'provider_schedule_mode_periods',
    'doctor_service_qualifications', 'slot_capacity_configs', 'schedule_exceptions', 'doctor_schedules',
    'service_bookable_hours', 'booking_form_fields', 'clinic_booking_pages', 'clinic_booking_settings',
    'clinic_closed_dates', 'appointment_reminder_rules', 'appointment_message_templates',
    'panel_price_overrides', 'panel_exclusions', 'panel_fee_terms', 'panel_clinics',
    'consultation_tariff_rules', 'service_catalog', 'item_age_dosages',
    // BEFORE `items`, not after: both carry a foreign key to it. Ordered wrong,
    // the delete of `items` fails on the second run of the seed and not the
    // first, when the child tables are still empty.
    'new_item_requests', 'item_price_changes',
    'items', 'item_categories',
    'supplier_payment_allocations', 'supplier_payments', 'supplier_invoices',
    'suppliers', 'tax_rates', 'tax_codes', 'patient_alerts', 'patient_identity_changes', 'patients',
    'staff_role_assignments', 'staff_permission_grants', 'clinic_custom_roles',
    'staff_professional_audits', 'leave_request_attachments', 'leave_requests', 'staff_files', 'public_holidays', 'audit_logs',
    'chat_messages', 'chat_channels', 'rooms', 'queue_display_configs', 'staff_notifications',
    'notification_logs', 'media_assets', 'global_settings', 'visit_number_counters',
    'user_clinic_access', 'staff', 'users', 'clinics', 'tenants',
  ];

  const owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: RESET_URL }) });
  try {
    // ONE TRANSACTION, with the tenant set on it. `set_config(..., true)` is
    // transaction-local, and a pooled client hands consecutive statements to
    // different connections — so a session-level setting would be lost between
    // the DELETEs and they would silently match nothing again. DDL is
    // transactional in PostgreSQL, so the trigger toggles ride along and roll
    // back with everything else if any step fails.
    await owner.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, TENANT_ID);

        const exists = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM tenants WHERE id = $1`,
          TENANT_ID,
        );
        if (exists.length === 0) return;

        // Append-only tables refuse deletion by design, so the whole tenant is
        // dropped with those triggers off — legitimate here because this is a
        // seed rebuilding its OWN synthetic tenant on a disposable database,
        // and it is the only place in the repository that does it.
        //
        // ASKED OF THE DATABASE, not kept as a list here. The hand-written list
        // this replaces had gone stale — `label_prints` grew an append-only
        // trigger and nobody added it — and the per-table `catch` below turned
        // the resulting failure into a reset that quietly did nothing.
        const appendOnly = await tx.$queryRawUnsafe<{ relname: string }[]>(
          `SELECT DISTINCT c.relname
             FROM pg_trigger t
             JOIN pg_class c ON c.oid = t.tgrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = ANY($1)`,
          order,
        );

        for (const { relname } of appendOnly) {
          await tx.$executeRawUnsafe(`ALTER TABLE "${relname}" DISABLE TRIGGER USER`);
        }
        // NO per-table catch. Swallowing these is what let a reset that deleted
        // nothing look like a reset that worked; a stale table name in the list
        // above should stop the seed and say so.
        //
        // Two tables do not carry `tenant_id`: the tenant row is keyed by `id`,
        // and user↔clinic access hangs off the clinic. Both are deleted before
        // what they point at, so the sub-select still resolves.
        // EVERY TENANT TABLE IS ACCOUNTED FOR, asked of the database rather
        // than trusted.
        //
        // The list went stale the moment the Stage 1 + 2 migration added eight
        // tables. The first seed run passed — the new tables were still empty —
        // and the SECOND failed on a foreign key from `employee_salaries` to
        // `staff`. A failure that only appears once somebody has already used
        // the fixture is the worst kind to leave to chance, so every table
        // carrying `tenant_id` must now be either deleted above or named here.
        //
        // The exclusions are the catalogues and reference data this seed does
        // not own: they belong to whichever seed loads them, and this synthetic
        // tenant is never given any. That claim is CHECKED rather than
        // asserted — if one of them ever does hold a row for this tenant, the
        // `DELETE FROM tenants` at the end would fail on a foreign key, and a
        // named error here beats that.
        const NOT_THIS_SEEDS: string[] = [
          'diagnosis_catalog', 'dosage_units', 'consumption_methods', 'stock_units',
          'prescription_frequencies', 'indication_presets',
          'form_templates', 'custom_document_templates',
          'attachments', 'data_corrections', 'appointment_change_requests',
          'tenant_subscriptions',
        ];
        const tenantTables = (
          await tx.$queryRawUnsafe<{ table_name: string }[]>(
            `SELECT table_name FROM information_schema.columns
              WHERE table_schema = 'public' AND column_name = 'tenant_id'`,
          )
        ).map((row) => row.table_name);

        const unaccounted = tenantTables.filter(
          (name) => !order.includes(name) && !NOT_THIS_SEEDS.includes(name),
        );
        if (unaccounted.length > 0) {
          throw new Error(
            `The reset list does not cover ${unaccounted.length} tenant table(s): ${unaccounted.join(', ')}. ` +
              'Add them in dependency order, or name them as a deliberate exclusion — otherwise this seed ' +
              'fails the second time it is run, and only then.',
          );
        }

        for (const table of NOT_THIS_SEEDS) {
          if (!tenantTables.includes(table)) continue;
          const [{ count }] = await tx.$queryRawUnsafe<{ count: bigint }[]>(
            `SELECT count(*) FROM "${table}" WHERE tenant_id = $1`,
            TENANT_ID,
          );
          if (Number(count) > 0) {
            throw new Error(
              `"${table}" is excluded from the reset because this seed does not own it, but it holds ` +
                `${count} row(s) for the UAT tenant. Either it is now this seed's business — add it to the ` +
                'delete list in dependency order — or something else is writing into this tenant.',
            );
          }
        }

        const predicate: Record<string, string> = {
          tenants: 'id = $1',
          user_clinic_access: 'clinic_id IN (SELECT id FROM clinics WHERE tenant_id = $1)',
        };
        for (const table of order) {
          const where = predicate[table] ?? 'tenant_id = $1';
          await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE ${where}`, TENANT_ID);
        }
        for (const { relname } of appendOnly) {
          await tx.$executeRawUnsafe(`ALTER TABLE "${relname}" ENABLE TRIGGER USER`);
        }

        const left = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM tenants WHERE id = $1`,
          TENANT_ID,
        );
        if (left.length > 0) {
          throw new Error('Tenant still present after the reset — refusing to rebuild on top of it.');
        }
      },
      { timeout: 120_000 },
    );
  } catch (error) {
    throw new Error(
      `Could not clear the UAT tenant. This needs the DATABASE OWNER, not the application role: ` +
        `set ADMIN_UAT_RESET_URL to an owner connection string and run again. ` +
        `Underlying error: ${(error as Error).message}`,
    );
  } finally {
    await owner.$disconnect();
  }
}

type Ids = Awaited<ReturnType<typeof buildIdsType>>;
declare function buildIdsType(): Promise<{
  tenant: { id: string };
  central: { id: string; name: string };
  branch: { id: string; name: string };
  staff: Record<string, string>;
  services: { id: string; name: string; price: Prisma.Decimal; category: string | null }[];
  items: Record<string, { id: string; name: string; sellPrice: Prisma.Decimal; cost: Prisma.Decimal | null }>;
  // feeTreatment travels with the panel because the seed writes adjudication
  // figures directly, and those have to land on the receivable the engine will
  // compute — which depends on how this panel's fee is treated.
  panels: {
    id: string;
    name: string;
    code: string | null;
    feeTreatment: 'WITHHELD_FROM_CLAIM' | 'ADDED_TO_RECEIVABLE' | 'NO_FEE' | 'UNCONFIGURED';
  }[];
  suppliers: { id: string; name: string; paymentTermDays: number | null }[];
  sst: { id: string };
  exempt: { id: string };
}>;

// ---------------------------------------------------------------------------
// STOCK: opening balances, a purchase order, a transfer with a discrepancy,
// near-expiry stock, a negative balance and a slow mover.
// ---------------------------------------------------------------------------
/**
 * One writer for stock movements, shared by the stock and dispensing seeds.
 *
 * A movement without the level it justifies is a ledger that does not add up,
 * and `verify()` re-derives every level from these rows — so both halves have
 * to be written together, everywhere, including from the clinical seed where
 * dispensing consumes stock.
 */
async function postMove(
  tx: Tx,
  tenantId: string,
  staffId: string,
  clinicId: string,
  itemId: string,
  delta: number,
  type: string,
  extra: Record<string, unknown> = {},
) {
  await tx.stockMovement.create({
    data: {
      tenantId, clinicId, itemId, quantityDelta: delta,
      movementType: type as never, createdByStaffId: staffId, ...extra,
    },
  });
  await tx.stockLevel.upsert({
    where: { tenantId_clinicId_itemId: { tenantId, clinicId, itemId } },
    create: { tenantId, clinicId, itemId, quantityOnHand: delta, minThreshold: 20 },
    update: { quantityOnHand: { increment: delta } },
  });
}

async function seedStock(ids: Ids) {
  await withTenant(async (tx) => {
    const { tenant, central, branch, staff, items, suppliers } = ids;

    const move = (clinicId: string, itemId: string, delta: number, type: string, extra: Record<string, unknown> = {}) =>
      postMove(tx, tenant.id, staff.stock, clinicId, itemId, delta, type, extra);

    // Opening balances at both branches.
    for (const [code, quantity] of Object.entries({ AMOX500: 120, MET500: 90, AML5: 80, SEMA025: 14, FOL5: 60, DRESS1: 45, PARA500: 200, OLDSYR: 30 })) {
      await move(central.id, items[code].id, quantity, 'OPENING_BALANCE', { adjustmentReason: 'OPENING_BALANCE', notes: 'Opening balance at go-live' });
      await move(branch.id, items[code].id, Math.round(quantity / 3), 'OPENING_BALANCE', { adjustmentReason: 'OPENING_BALANCE' });
    }

    // BELOW MINIMUM — a couple of items dispensed down past their threshold.
    await move(central.id, items.PARA500.id, -185, 'DISPENSED', { referenceType: 'SeedDispensing' });
    await move(branch.id, items.AMOX500.id, -32, 'DISPENSED', { referenceType: 'SeedDispensing' });

    // NEGATIVE STOCK — dispensed beyond what the system knew about (D-020).
    await move(branch.id, items.FOL5.id, -28, 'DISPENSED', {
      referenceType: 'SeedDispensing',
      notes: 'Dispensed with an acknowledged stock shortage.',
    });

    // NEAR EXPIRY and EXPIRED batches.
    await tx.stockBatch.create({
      data: {
        tenantId: tenant.id, clinicId: central.id, itemId: items.AMOX500.id,
        batchNumber: 'B-2026-14', quantity: 40, expiryDate: day(45), receivedDate: day(-120),
        supplierId: suppliers[0].id, addedByStaffId: staff.stock,
      },
    });
    await tx.stockBatch.create({
      data: {
        tenantId: tenant.id, clinicId: central.id, itemId: items.OLDSYR.id,
        batchNumber: 'B-2025-77', quantity: 12, expiryDate: day(-20), receivedDate: day(-400),
        supplierId: suppliers[2].id, addedByStaffId: staff.stock,
      },
    });

    // PURCHASE ORDERS — one fully received, one still outstanding.
    const receivedPo = await tx.purchaseOrder.create({
      data: { tenantId: tenant.id, clinicId: central.id, supplierId: suppliers[0].id, status: 'FULLY_RECEIVED', orderedAt: day(-30) },
    });
    const receivedLine = await tx.purchaseOrderLine.create({
      data: { tenantId: tenant.id, purchaseOrderId: receivedPo.id, itemId: items.AMOX500.id, orderedQuantity: 100, receivedQuantity: 100, unitCost: 4.3 },
    });
    const grn = await tx.goodsReceivedNote.create({
      data: { tenantId: tenant.id, clinicId: central.id, purchaseOrderId: receivedPo.id, receivedAt: day(-25) },
    });
    await tx.goodsReceivedNoteLine.create({
      data: { tenantId: tenant.id, goodsReceivedNoteId: grn.id, purchaseOrderLineId: receivedLine.id, itemId: items.AMOX500.id, quantityReceived: 100, unitCost: 4.3 },
    });
    await move(central.id, items.AMOX500.id, 100, 'GOODS_RECEIVED', { referenceType: 'GoodsReceivedNote', referenceId: grn.id });

    // --- NEW ITEM REQUESTS ------------------------------------------------
    //
    // Three, so the screen shows every state: one waiting on a decision, one
    // approved and sitting in the catalogue UNUSABLE until stock arrives, and
    // one flagged as looking like something the catalogue already has — which
    // is the check the clinic's five-column sheet has never had.
    const approvedNewItem = await tx.item.create({
      data: {
        tenantId: tenant.id, name: 'Semaglutide 0.25mg Pen (Synthetic)', code: 'SEMA025PEN',
        category: 'Weight Management', unitOfMeasure: 'Pen', sellPrice: 420, cost: 315,
        active: false, awaitingFirstReceipt: true,
      },
    });
    await tx.itemPriceChange.create({
      data: {
        tenantId: tenant.id, itemId: approvedNewItem.id, newCost: 315, newSellPrice: 420,
        source: 'NEW_ITEM_REQUEST', changedByStaffId: staff.stock,
        note: 'Opening price on approval of a new-item request.', changedAt: at(-8, 10),
      },
    });
    await tx.newItemRequest.createMany({
      data: [
        {
          tenantId: tenant.id, clinicId: central.id,
          requestedName: 'Semaglutide 0.25mg pen',
          reason: 'Two patients started on it at the hospital and we cannot continue their treatment.',
          packSizeNote: '1 pen = 4 weekly doses', suggestedSupplierId: suppliers[1].id,
          indicativeCost: 315, indicativePrice: 420,
          status: 'APPROVED', decisionNote: 'Approved for the weight-management programme.',
          decidedByStaffId: staff.stock, decidedAt: at(-8, 10), createdItemId: approvedNewItem.id,
          requestedByStaffId: staff.counter, createdAt: at(-10, 9), updatedAt: at(-8, 10),
        },
        {
          tenantId: tenant.id, clinicId: branch.id,
          requestedName: 'Cetirizine 10mg syrup',
          reason: 'Paediatric patients cannot swallow the tablet and we are splitting adult doses.',
          packSizeNote: '1 bottle = 60ml', indicativeCost: 8.5, indicativePrice: 16,
          status: 'PENDING', requestedByStaffId: staff.counter2,
          createdAt: at(-3, 14), updatedAt: at(-3, 14),
        },
        {
          tenantId: tenant.id, clinicId: central.id,
          requestedName: 'amoxicillin 250mg caps',
          reason: 'The paediatric strength is not stocked and we write it by hand every week.',
          status: 'PENDING', possibleDuplicateItemId: items.AMOX500.id,
          requestedByStaffId: staff.counter, createdAt: at(-1, 11), updatedAt: at(-1, 11),
        },
      ],
    });

    // A cost that moved at goods-in, on an item already in the catalogue — the
    // "old price / new price" columns the clinic keeps on its order queue.
    await tx.itemPriceChange.create({
      data: {
        tenantId: tenant.id, itemId: items.AMOX500.id, previousCost: 4.1, newCost: 4.3,
        source: 'GOODS_RECEIPT', goodsReceivedNoteId: grn.id, changedByStaffId: staff.stock,
        note: 'Cost changed at goods-in.', changedAt: at(-25, 11),
      },
    });

    // --- ACCOUNTS PAYABLE -------------------------------------------------
    //
    // Five invoices, chosen so the payables screen shows every state a real
    // book has: settled, part-paid and overdue, disputed, falling due inside
    // the week, and one on the supplier whose terms nobody recorded — which
    // has NO due date at all and is counted separately.
    //
    // The first is linked to the goods receipt above so the three-way match is
    // demonstrable: 100 units at RM4.30 is RM430, and the invoice asks RM430.
    const paidInvoice = await tx.supplierInvoice.create({
      data: {
        tenantId: tenant.id, supplierId: suppliers[0].id, invoiceNumber: 'CPS-2026-4471',
        invoiceDate: day(-25), dueDate: day(5), totalAmount: 430, taxAmount: 0,
        goodsReceivedNoteId: grn.id, purchaseOrderId: receivedPo.id,
        recordedByStaffId: staff.stock, createdAt: at(-24, 9),
      },
    });
    const overdueInvoice = await tx.supplierInvoice.create({
      data: {
        tenantId: tenant.id, supplierId: suppliers[0].id, invoiceNumber: 'CPS-2026-4388',
        invoiceDate: day(-70), dueDate: day(-40), totalAmount: 2860,
        recordedByStaffId: staff.stock, createdAt: at(-69, 9),
      },
    });
    const dueSoonInvoice = await tx.supplierInvoice.create({
      data: {
        tenantId: tenant.id, supplierId: suppliers[1].id, invoiceNumber: 'BMT-88213',
        invoiceDate: day(-57), dueDate: day(3), totalAmount: 6300,
        recordedByStaffId: staff.stock, createdAt: at(-56, 10),
      },
    });
    await tx.supplierInvoice.create({
      data: {
        tenantId: tenant.id, supplierId: suppliers[1].id, invoiceNumber: 'BMT-88540',
        invoiceDate: day(-30), dueDate: day(30), totalAmount: 940, status: 'DISPUTED',
        disputeReason: 'Billed for 4 boxes of dressing packs; 3 were delivered. Credit note requested.',
        recordedByStaffId: staff.stock, createdAt: at(-29, 11),
      },
    });
    await tx.supplierInvoice.create({
      data: {
        tenantId: tenant.id, supplierId: suppliers[2].id, invoiceNumber: 'SIN-0092',
        invoiceDate: day(-45), dueDate: null, totalAmount: 615,
        notes: 'No payment term agreed with this supplier yet.',
        recordedByStaffId: staff.stock, createdAt: at(-44, 9),
      },
    });

    // One transfer settles the matched invoice in full and part of the overdue
    // one. Both invoices' paid figures come from THESE allocations — nothing is
    // typed onto an invoice.
    await tx.supplierPayment.create({
      data: {
        tenantId: tenant.id, supplierId: suppliers[0].id, paidAt: day(-12), amount: 1430,
        method: 'Bank transfer', reference: 'FT26081200417', recordedByStaffId: staff.finance,
        createdAt: at(-12, 15),
        allocations: {
          create: [
            { tenantId: tenant.id, supplierInvoiceId: paidInvoice.id, amount: 430 },
            { tenantId: tenant.id, supplierInvoiceId: overdueInvoice.id, amount: 1000 },
          ],
        },
      },
    });
    await tx.supplierInvoice.update({ where: { id: paidInvoice.id }, data: { status: 'PAID' } });
    void dueSoonInvoice;

    const openPo = await tx.purchaseOrder.create({
      data: { tenantId: tenant.id, clinicId: central.id, supplierId: suppliers[1].id, status: 'ORDERED', orderedAt: day(-6) },
    });
    await tx.purchaseOrderLine.create({
      data: { tenantId: tenant.id, purchaseOrderId: openPo.id, itemId: items.SEMA025.id, orderedQuantity: 20, unitCost: 315 },
    });

    // Two pending procurement requests. The branch one is what the workflow is
    // FOR — a branch asking central to buy something — but the owner account is
    // pinned to Central, so on its own it left the Procurement Requests screen
    // showing an empty table. The Central one is what that account sees.
    await tx.procurementRequest.create({
      data: { tenantId: tenant.id, clinicId: branch.id, itemId: items.MET500.id, requestedQuantity: 60, status: 'PENDING' },
    });
    await tx.procurementRequest.create({
      data: { tenantId: tenant.id, clinicId: central.id, itemId: items.AMOX500.id, requestedQuantity: 200, status: 'PENDING' },
    });

    // A monthly purchasing budget.
    await tx.procurementBudget.create({
      data: { tenantId: tenant.id, clinicId: central.id, period: monthStart(), amount: 15000, createdByStaffId: staff.owner },
    });

    // TRANSFER 1 — clean, received in full.
    const clean = await tx.stockTransfer.create({
      data: {
        tenantId: tenant.id, transferNumber: nextNumber('TRF'), fromClinicId: central.id, toClinicId: branch.id,
        status: 'RECEIVED', createdByStaffId: staff.stock, sentByStaffId: staff.stock, sentAt: day(-12),
        receivedByStaffId: staff.counter2, receivedAt: day(-11),
        // The two branches are separate entities, so this movement has to be
        // billed between them. Without a flagged transfer the Inter-company
        // screen had nothing to list and read as a broken page rather than an
        // empty one.
        interCompany: true, interCompanyReference: 'IC-2026-0041',
        lines: { create: [{ tenantId: tenant.id, itemId: items.MET500.id, quantitySent: 30, quantityReceived: 30, unitCost: 3.2 }] },
      },
    });
    await move(central.id, items.MET500.id, -30, 'TRANSFER_OUT', { referenceType: 'StockTransfer', referenceId: clean.id });
    await move(branch.id, items.MET500.id, 30, 'TRANSFER_IN', { referenceType: 'StockTransfer', referenceId: clean.id });

    // TRANSFER 2 — a DISCREPANCY. Two strips never arrived and stay missing.
    const short = await tx.stockTransfer.create({
      data: {
        tenantId: tenant.id, transferNumber: nextNumber('TRF'), fromClinicId: central.id, toClinicId: branch.id,
        // Also inter-company, and deliberately WITHOUT a billing reference, so
        // the warning the screen exists to raise — stock left one entity and
        // arrived at another with nothing recorded to bill against — has a real
        // case rather than a hypothetical one.
        interCompany: true,
        status: 'RECEIVED_WITH_DISCREPANCY', createdByStaffId: staff.stock, sentByStaffId: staff.stock, sentAt: day(-5),
        receivedByStaffId: staff.counter2, receivedAt: day(-4),
        lines: {
          create: [{
            tenantId: tenant.id, itemId: items.AML5.id, quantitySent: 25, quantityReceived: 23, unitCost: 3.8,
            discrepancyReason: 'Two strips crushed in transit and discarded at the receiving branch',
          }],
        },
      },
    });
    await move(central.id, items.AML5.id, -25, 'TRANSFER_OUT', { referenceType: 'StockTransfer', referenceId: short.id });
    await move(branch.id, items.AML5.id, 23, 'TRANSFER_IN', { referenceType: 'StockTransfer', referenceId: short.id, notes: '25 sent, 23 received' });

    // TRANSFER 3 — still in transit, awaiting confirmation.
    const transit = await tx.stockTransfer.create({
      data: {
        tenantId: tenant.id, transferNumber: nextNumber('TRF'), fromClinicId: central.id, toClinicId: branch.id,
        status: 'SENT', createdByStaffId: staff.stock, sentByStaffId: staff.stock, sentAt: day(-1),
        lines: { create: [{ tenantId: tenant.id, itemId: items.DRESS1.id, quantitySent: 10, unitCost: 7.4 }] },
      },
    });
    await move(central.id, items.DRESS1.id, -10, 'TRANSFER_OUT', { referenceType: 'StockTransfer', referenceId: transit.id });

    // A POSTED stock take, so the history has one.
    const take = await tx.stockTake.create({
      data: {
        tenantId: tenant.id, clinicId: central.id, takeNumber: nextNumber('ST'), name: 'Quarterly count — dispensary',
        status: 'POSTED', createdByStaffId: staff.stock, submittedByStaffId: staff.stock, submittedAt: day(-40),
        reviewedByStaffId: staff.owner, reviewedAt: day(-39), postedAt: day(-39), varianceValue: -13.6,
        lines: {
          create: [
            { tenantId: tenant.id, itemId: items.PARA500.id, systemQuantity: 22, countedQuantity: 18, unitCost: 1.2, countedByStaffId: staff.stock, countedAt: day(-40), varianceReason: 'Four strips unaccounted for' },
            { tenantId: tenant.id, itemId: items.FOL5.id, systemQuantity: 60, countedQuantity: 60, unitCost: 1.6, countedByStaffId: staff.stock, countedAt: day(-40) },
          ],
        },
      },
    });
    await move(central.id, items.PARA500.id, -4, 'STOCK_TAKE', { adjustmentReason: 'COUNT_CORRECTION', referenceType: 'StockTake', referenceId: take.id, notes: 'Four strips unaccounted for' });

    // An OPEN stock take at the branch, waiting to be counted.
    const levels = await tx.stockLevel.findMany({ where: { clinicId: branch.id }, include: { item: true } });
    await tx.stockTake.create({
      data: {
        tenantId: tenant.id, clinicId: branch.id, takeNumber: nextNumber('ST'), name: 'Month-end count — Bandar',
        status: 'COUNTING', createdByStaffId: staff.stock,
        counters: { create: [{ tenantId: tenant.id, staffId: staff.counter2, location: 'Front dispensary' }] },
        lines: {
          create: levels.map((level) => ({
            tenantId: tenant.id, itemId: level.itemId, systemQuantity: level.quantityOnHand, unitCost: level.item.cost,
          })),
        },
      },
    });

    // A COUNTING take AT CENTRAL TOO. The owner account is bound to Contoh
    // Central (they are the principal doctor there), so the Bandar count above
    // is not reachable from it — and a count that nobody reviewing this system
    // can open does not demonstrate the count → submit → approve → post chain
    // the workflow exists for. One partly-counted take at the owner's own
    // branch is what makes that chain visible.
    const centralLevels = await tx.stockLevel.findMany({
      where: { clinicId: central.id },
      include: { item: true },
      orderBy: { itemId: 'asc' },
      take: 6,
    });
    await tx.stockTake.create({
      data: {
        tenantId: tenant.id, clinicId: central.id, takeNumber: nextNumber('ST'), name: 'Month-end count — dispensary',
        status: 'COUNTING', createdByStaffId: staff.stock,
        counters: { create: [{ tenantId: tenant.id, staffId: staff.stock, location: 'Dispensary shelf A' }] },
        lines: {
          create: centralLevels.map((level, index) => ({
            tenantId: tenant.id,
            itemId: level.itemId,
            systemQuantity: level.quantityOnHand,
            unitCost: level.item.cost,
            // Half the shelf counted, one line short of what the system says —
            // so the progress bar, the variance column and the "not counted
            // yet" state are all on screen at once.
            ...(index < 3
              ? {
                  countedQuantity: index === 1 ? level.quantityOnHand - 2 : level.quantityOnHand,
                  countedByStaffId: staff.stock,
                  countedAt: day(-1),
                  ...(index === 1 ? { varianceReason: 'Two boxes not on the shelf' } : {}),
                }
              : {}),
          })),
        },
      },
    });

    // An EXPIRY write-off, so the reason column has a real case.
    await move(central.id, items.OLDSYR.id, -12, 'EXPIRY', {
      adjustmentReason: 'EXPIRED',
      notes: 'Batch B-2025-77 past expiry, disposed per SOP',
    });
    console.log('  stock: opening balances, POs, 3 transfers, 2 stock takes, expiry write-off');
  });
}

// ---------------------------------------------------------------------------
// CLINICAL AND FINANCE: visits, invoices, payments (cash/card/QR/partial/
// refund/reversal), a credit note, outstanding invoices and day-end closings.
// ---------------------------------------------------------------------------
async function seedClinicalAndFinance(ids: Ids) {
  await withTenant(async (tx) => {
    const { tenant, central, branch, staff, services, items, panels } = ids;

    const patients = await Promise.all(
      [
        ['Amir bin Hassan', '000000-00-0101', 'MALE', '013-1000001'],
        ['Bibi Zainal', '000000-00-0102', 'FEMALE', '013-1000002'],
        ['Chong Wei Ming', '000000-00-0103', 'MALE', '013-1000003'],
        ['Devi Ramasamy', '000000-00-0104', 'FEMALE', '013-1000004'],
        ['Eshan Kumar', '000000-00-0105', 'MALE', '013-1000005'],
        ['Farah Nadia', '000000-00-0106', 'FEMALE', '013-1000006'],
        ['Gopal Krishnan', '000000-00-0107', 'MALE', '013-1000007'],
        ['Hana Yusof', '000000-00-0108', 'FEMALE', '013-1000008'],
      ].map(([name, ic, gender, phone], index) =>
        tx.patient.create({
          data: {
            tenantId: tenant.id,
            name,
            identifierType: 'NRIC',
            identifierValue: ic,
            gender,
            phone,
            dob: new Date(Date.UTC(1975 + index * 3, index % 12, 12)),
          },
        }),
      ),
    );

    let visitSeq = 0;
    async function makeVisit(opts: {
      patientIndex: number;
      clinicId: string;
      doctorKey: string;
      dayOffset: number;
      panelIndex?: number;
      lines: { description: string; amount: number; serviceIndex?: number; itemCode?: string; taxable?: boolean }[];
    }) {
      const patient = patients[opts.patientIndex];
      const panel = opts.panelIndex === undefined ? null : panels[opts.panelIndex];
      const visit = await tx.visit.create({
        data: {
          tenantId: tenant.id,
          clinicId: opts.clinicId,
          patientId: patient.id,
          visitNumber: `V-${String(++visitSeq).padStart(6, '0')}`,
          billingType: panel ? 'PANEL' : 'SELF_PAY',
          panelClinicId: panel?.id ?? null,
          panelVerificationStatus: panel ? 'VERIFIED' : undefined,
          registeredByStaffId: staff.counter,
          staffId: staff[opts.doctorKey],
          createdAt: at(opts.dayOffset, 2, 30),
          checkInAt: at(opts.dayOffset, 2, 30),
        },
      });
      await tx.diagnosis.create({
        data: {
          tenantId: tenant.id, visitId: visit.id, name: 'Acute upper respiratory infection',
          priority: 'PRIMARY', addedByStaffId: staff[opts.doctorKey], addedAt: at(opts.dayOffset, 3),
        },
      });

      const subtotal = opts.lines.reduce((total, line) => total + line.amount, 0);
      const taxable = opts.lines.filter((line) => line.taxable !== false).reduce((total, line) => total + line.amount, 0);
      const tax = Math.round(taxable * 0.06 * 100) / 100;
      const total = Math.round((subtotal + tax) * 100) / 100;
      const panelShare = panel ? Math.min(subtotal, Number(panel.code === 'KILANG' ? 100 : panel.code === 'SEJAHTERA' ? 200 : 150)) : 0;
      const patientShare = Math.round((total - panelShare) * 100) / 100;

      const invoice = await tx.invoice.create({
        data: {
          tenantId: tenant.id,
          visitId: visit.id,
          invoiceNumber: `INV-${String(visitSeq).padStart(6, '0')}`,
          createdByStaffId: staff.counter,
          subtotalAmount: subtotal,
          taxAmount: tax,
          totalAmount: total,
          panelResponsibilityAmount: panelShare,
          patientResponsibilityAmount: patientShare,
          panelCoveredAmount: panelShare,
          createdAt: at(opts.dayOffset, 4),
        },
      });
      for (const line of opts.lines) {
        // A BILLED LINE POINTS AT WHAT PRODUCED IT.
        //
        // Kuwick derives a line's COST, its business SEGMENT and its
        // PROGRAMME attribution by walking back from the invoice line to the
        // prescription or the ordered service behind it — there is no cost
        // column on the line itself, deliberately, because a snapshot that can
        // drift from the catalogue is a second source of truth.
        //
        // A seed that writes bare descriptions therefore produces screens that
        // are technically correct and completely uninformative: every margin
        // reads 100%, every segment lands in "Not classified", and every
        // programme dashboard reports nothing dispensed. So the fixtures write
        // the real chain — prescription, dispensing movement, ordered service —
        // and the reports have something true to compute from.
        let sourcePrescriptionId: string | null = null;
        let sourceOrderServiceId: string | null = null;

        if (line.itemCode) {
          const item = items[line.itemCode];
          const prescription = await tx.prescription.create({
            data: {
              tenantId: tenant.id,
              visitId: visit.id,
              itemId: item.id,
              quantity: 1,
              amount: line.amount,
              frequency: 'TDS',
              durationDays: 5,
              status: 'DISPENSED',
              prescribedByStaffId: staff[opts.doctorKey],
              prescribedAt: at(opts.dayOffset, 3),
              dispensedByStaffId: staff.counter,
              dispensedAt: at(opts.dayOffset, 4),
            },
          });
          sourcePrescriptionId = prescription.id;
          // Dispensing moves stock. Written through the one movement writer so
          // the level and the ledger stay equal — verify() checks that they do.
          await postMove(tx, tenant.id, staff.counter, opts.clinicId, item.id, -1, 'DISPENSED', {
            referenceType: 'Prescription',
            referenceId: prescription.id,
          });
        } else if (line.serviceIndex !== undefined) {
          const service = services[line.serviceIndex];
          const ordered = await tx.orderService.create({
            data: {
              tenantId: tenant.id,
              clinicId: opts.clinicId,
              visitId: visit.id,
              serviceCatalogId: service.id,
              procedureName: service.name,
              orderType: 'STANDARD_SERVICE',
              quantity: 1,
              status: 'COMPLETED',
              requestedByStaffId: staff[opts.doctorKey],
              requestedAt: at(opts.dayOffset, 3),
              completedAt: at(opts.dayOffset, 4),
            },
          });
          sourceOrderServiceId = ordered.id;
        }

        await tx.invoiceLine.create({
          data: {
            tenantId: tenant.id,
            invoiceId: invoice.id,
            description: line.description,
            quantity: 1,
            unitPrice: line.amount,
            amount: line.amount,
            sourcePrescriptionId,
            sourceOrderServiceId,
            taxCodeId: line.taxable === false ? ids.exempt.id : ids.sst.id,
            taxTreatment: line.taxable === false ? 'EXEMPT' : 'STANDARD_RATED',
            taxRatePercent: line.taxable === false ? null : 6,
            taxAmount: line.taxable === false ? 0 : Math.round(line.amount * 0.06 * 100) / 100,
            createdAt: at(opts.dayOffset, 4),
          },
        });
      }
      return { visit, invoice, patientShare, panelShare, total };
    }

    async function pay(invoiceId: string, clinicId: string, amount: number, tender: string, dayOffset: number, hour = 5, kind: 'PAYMENT' | 'REFUND' = 'PAYMENT', extra: Record<string, unknown> = {}) {
      return tx.payment.create({
        data: {
          tenantId: tenant.id, clinicId, invoiceId, kind, tender: tender as never,
          methodLabel: tender === 'CASH' ? 'Cash' : tender === 'CARD' ? 'Credit Card' : tender === 'QR' ? 'DuitNow QR' : tender === 'BANK_TRANSFER' ? 'Bank Transfer' : tender,
          amount, receivedAt: at(dayOffset, hour), receivedByStaffId: staff.counter, ...extra,
        },
      });
    }

    const CONSULT = Number(services[0].price);
    const DRESSING = Number(services[1].price);
    const SUTURE = Number(services[2].price);
    const ANTENATAL = Number(services[3].price);
    const NCD = Number(services[4].price);
    const WEIGHT = Number(services[5].price);

    // --- Yesterday at Central: a full day, closed and reconciled -----------
    const y1 = await makeVisit({ patientIndex: 0, clinicId: central.id, doctorKey: 'owner', dayOffset: -1, lines: [{ description: 'General Consultation', amount: CONSULT, serviceIndex: 0 }, { description: 'Amoxicillin 500mg', amount: Number(items.AMOX500.sellPrice), itemCode: 'AMOX500', taxable: false }] });
    await pay(y1.invoice.id, central.id, y1.patientShare, 'CASH', -1, 5);
    await tx.invoice.update({ where: { id: y1.invoice.id }, data: { status: 'PAID', paidAt: at(-1, 5), paymentMethod: 'Cash', patientPaidAmount: y1.patientShare } });

    const y2 = await makeVisit({ patientIndex: 1, clinicId: central.id, doctorKey: 'resident', dayOffset: -1, lines: [{ description: 'Suturing (minor)', amount: SUTURE, serviceIndex: 2 }, { description: 'Dressing Pack', amount: Number(items.DRESS1.sellPrice), itemCode: 'DRESS1', taxable: false }] });
    await pay(y2.invoice.id, central.id, y2.patientShare, 'CARD', -1, 6);
    await tx.invoice.update({ where: { id: y2.invoice.id }, data: { status: 'PAID', paidAt: at(-1, 6), paymentMethod: 'Credit Card', patientPaidAmount: y2.patientShare } });

    const y3 = await makeVisit({ patientIndex: 2, clinicId: central.id, doctorKey: 'owner', dayOffset: -1, lines: [{ description: 'NCD Review', amount: NCD, serviceIndex: 4 }, { description: 'Metformin 500mg', amount: Number(items.MET500.sellPrice), itemCode: 'MET500', taxable: false }] });
    await pay(y3.invoice.id, central.id, y3.patientShare, 'QR', -1, 7);
    await tx.invoice.update({ where: { id: y3.invoice.id }, data: { status: 'PAID', paidAt: at(-1, 7), paymentMethod: 'DuitNow QR', patientPaidAmount: y3.patientShare } });

    // Yesterday's closing: counted, closed, RM5 short with an explanation.
    const expectedCash = y1.patientShare;
    const expectedCard = y2.patientShare;
    const expectedQr = y3.patientShare;
    const closing = await tx.dayEndClosing.create({
      data: {
        tenantId: tenant.id, clinicId: central.id, businessDate: day(-1), status: 'CLOSED',
        expectedCash, expectedCard, expectedQr, expectedOther: 0,
        expectedTotal: expectedCash + expectedCard + expectedQr,
        countedCash: expectedCash - 5, countedCard: expectedCard, countedQr: expectedQr, countedOther: 0,
        varianceAmount: -5, varianceReason: 'RM5 taken from the float for parking, receipt in the tin',
        invoiceCount: 3, paymentCount: 3,
        countedByStaffId: staff.counter, countedAt: at(-1, 12),
        closedByStaffId: staff.finance, closedAt: at(-1, 12, 30),
        snapshot: { operational: { invoiceCount: 3, visitCount: 3, panelInvoiceCount: 0, billed: y1.total + y2.total + y3.total } } as never,
      },
    });
    await tx.payment.updateMany({
      where: { clinicId: central.id, receivedAt: { gte: day(-1), lt: day(0) } },
      data: { dayEndClosingId: closing.id },
    });

    // --- Two days ago at Bandar: NOT closed. The finance work queue. ------
    const b1 = await makeVisit({ patientIndex: 3, clinicId: branch.id, doctorKey: 'locum', dayOffset: -2, lines: [{ description: 'General Consultation', amount: CONSULT, serviceIndex: 0 }] });
    await pay(b1.invoice.id, branch.id, b1.patientShare, 'CASH', -2, 4);
    await tx.invoice.update({ where: { id: b1.invoice.id }, data: { status: 'PAID', paidAt: at(-2, 4), paymentMethod: 'Cash', patientPaidAmount: b1.patientShare } });

    const b2 = await makeVisit({ patientIndex: 4, clinicId: branch.id, doctorKey: 'locum', dayOffset: -2, lines: [{ description: 'Wound Dressing', amount: DRESSING, serviceIndex: 1 }] });
    await pay(b2.invoice.id, branch.id, b2.patientShare, 'QR', -2, 6);
    await tx.invoice.update({ where: { id: b2.invoice.id }, data: { status: 'PAID', paidAt: at(-2, 6), paymentMethod: 'DuitNow QR', patientPaidAmount: b2.patientShare } });

    // --- A PARTIAL payment, still outstanding -----------------------------
    const partial = await makeVisit({ patientIndex: 5, clinicId: central.id, doctorKey: 'owner', dayOffset: -8, lines: [{ description: 'Weight Management Review', amount: WEIGHT, serviceIndex: 5 }, { description: 'Semaglutide 0.25mg pen', amount: Number(items.SEMA025.sellPrice), itemCode: 'SEMA025', taxable: false }] });
    await pay(partial.invoice.id, central.id, 200, 'CASH', -8, 5);
    await tx.invoice.update({ where: { id: partial.invoice.id }, data: { patientPaidAmount: 200 } });

    // --- A REFUND that reopened a balance ---------------------------------
    const refunded = await makeVisit({ patientIndex: 6, clinicId: central.id, doctorKey: 'resident', dayOffset: -14, lines: [{ description: 'Suturing (minor)', amount: SUTURE, serviceIndex: 2 }] });
    await pay(refunded.invoice.id, central.id, refunded.patientShare, 'CARD', -14, 5);
    await pay(refunded.invoice.id, central.id, 60, 'CARD', -12, 9, 'REFUND', { notes: 'Procedure abandoned; portion returned' });
    await tx.invoice.update({ where: { id: refunded.invoice.id }, data: { patientPaidAmount: refunded.patientShare - 60 } });

    // --- A REVERSED payment (recorded in error) ---------------------------
    // Inside the current month, so the payments screen's default window shows
    // it on any day of any month. See `dayInCurrentMonth`.
    const reversalOffset = Math.round((dayInCurrentMonth(-20).getTime() - day(0).getTime()) / 86400000);
    const reversedInvoice = await makeVisit({ patientIndex: 7, clinicId: central.id, doctorKey: 'owner', dayOffset: reversalOffset, lines: [{ description: 'General Consultation', amount: CONSULT, serviceIndex: 0 }] });
    const wrong = await pay(reversedInvoice.invoice.id, central.id, reversedInvoice.patientShare, 'CASH', reversalOffset, 5);
    await tx.payment.create({
      data: {
        tenantId: tenant.id, clinicId: central.id, invoiceId: reversedInvoice.invoice.id,
        kind: 'REFUND', tender: 'CASH', amount: reversedInvoice.patientShare, receivedAt: at(reversalOffset, 6),
        receivedByStaffId: staff.finance, reversesPaymentId: wrong.id, reversedAt: at(reversalOffset, 6),
        reversalReason: 'Recorded against the wrong patient at the counter',
      },
    });
    await tx.payment.update({ where: { id: wrong.id }, data: { reversedAt: at(reversalOffset, 6) } });

    // --- OUTSTANDING invoices at several ages -----------------------------
    for (const [index, offset] of [-15, -45, -75, -120].entries()) {
      await makeVisit({
        patientIndex: index,
        clinicId: index % 2 === 0 ? central.id : branch.id,
        doctorKey: index % 2 === 0 ? 'owner' : 'locum',
        dayOffset: offset,
        lines: [{ description: 'General Consultation', amount: CONSULT, serviceIndex: 0 }, { description: 'Wound Dressing', amount: DRESSING, serviceIndex: 1 }],
      });
    }

    // --- A CREDIT NOTE, issued --------------------------------------------
    const credited = await makeVisit({ patientIndex: 2, clinicId: central.id, doctorKey: 'owner', dayOffset: -10, lines: [{ description: 'Antenatal Review', amount: ANTENATAL, serviceIndex: 3 }, { description: 'Folic Acid 5mg', amount: Number(items.FOL5.sellPrice), itemCode: 'FOL5', taxable: false }] });
    await pay(credited.invoice.id, central.id, credited.patientShare, 'CASH', -10, 5);
    const creditLine = await tx.invoiceLine.findFirst({ where: { invoiceId: credited.invoice.id } });
    const note = await tx.creditNote.create({
      data: {
        tenantId: tenant.id, clinicId: central.id, creditNoteNumber: nextNumber('CN'),
        invoiceId: credited.invoice.id, status: 'ISSUED',
        reason: 'Antenatal review was billed twice on the same day',
        subtotalAmount: ANTENATAL, taxAmount: Math.round(ANTENATAL * 0.06 * 100) / 100,
        totalAmount: Math.round(ANTENATAL * 1.06 * 100) / 100,
        createdByStaffId: staff.finance, approvedByStaffId: staff.owner,
        approvedAt: at(-9, 3), issuedAt: at(-9, 3),
        lines: { create: [{ tenantId: tenant.id, invoiceLineId: creditLine?.id ?? null, description: 'Antenatal Review (duplicate)', quantity: 1, unitPrice: ANTENATAL, amount: ANTENATAL, taxAmount: Math.round(ANTENATAL * 0.06 * 100) / 100 }] },
      },
    });

    // --- A DRAFT credit note awaiting approval ----------------------------
    await tx.creditNote.create({
      data: {
        tenantId: tenant.id, clinicId: branch.id, creditNoteNumber: nextNumber('CN'),
        invoiceId: b2.invoice.id, status: 'DRAFT',
        reason: 'Dressing charged at the wrong tier',
        subtotalAmount: 10, taxAmount: 0.6, totalAmount: 10.6,
        createdByStaffId: staff.counter2,
        lines: { create: [{ tenantId: tenant.id, description: 'Dressing tier correction', quantity: 1, unitPrice: 10, amount: 10, taxAmount: 0.6 }] },
      },
    });

    // AND ONE AT CENTRAL, because the draft above is at Bandar and the owner
    // account is pinned to Central — so the DRAFT filter opened on an empty
    // table and the two-person approval rule, which is the whole point of this
    // screen, had nothing to demonstrate itself on. Raised by the finance
    // executive, so the Approve button belongs to somebody else.
    await tx.creditNote.create({
      data: {
        tenantId: tenant.id, clinicId: central.id, creditNoteNumber: nextNumber('CN'),
        invoiceId: partial.invoice.id, status: 'DRAFT',
        reason: 'Weight management review billed at the specialist rate in error',
        subtotalAmount: 30, taxAmount: 1.8, totalAmount: 31.8,
        createdByStaffId: staff.finance,
        lines: { create: [{ tenantId: tenant.id, description: 'Consultation rate correction', quantity: 1, unitPrice: 30, amount: 30, taxAmount: 1.8 }] },
      },
    });

    // -----------------------------------------------------------------------
    // TODAY AT CENTRAL — AN OPEN TRADING DAY, LEFT FOR THE OWNER TO CLOSE.
    //
    // The review board showed an almost-empty closing screen, and the reason
    // was arithmetic rather than a defect: every seeded trading day was in the
    // past and already closed, so the day-end screen opened on TODAY and
    // correctly reported that nothing had happened yet.
    //
    // This is a real day's takings, deliberately shaped so that closing it
    // exercises every rule the screen enforces:
    //
    //   - all four tender buckets, so the count form has four fields to fill;
    //   - a REFUND, which must reduce the CARD bucket rather than appear as a
    //     separate line, because money handed back left the drawer it entered;
    //   - a PANEL invoice, which contributes to the day's billing and to
    //     NOTHING in the drawer, since no cash changed hands;
    //   - a cash total ending in a figure the counter is meant to get WRONG:
    //     the UAT script counts RM20 short, so the variance, the mandatory
    //     reason and the closed-state lock are all provable rather than
    //     assertions in a document.
    //
    // NO `dayEndClosing` ROW IS WRITTEN. The day is OPEN because nobody has
    // counted it, which is the state the whole workflow starts from. Seeding a
    // closed day would have proved only that a seed can write a row.
    // -----------------------------------------------------------------------
    const t1 = await makeVisit({
      patientIndex: 0, clinicId: central.id, doctorKey: 'owner', dayOffset: 0,
      lines: [
        { description: 'General Consultation', amount: CONSULT, serviceIndex: 0 },
        { description: 'Amoxicillin 500mg', amount: Number(items.AMOX500.sellPrice), itemCode: 'AMOX500', taxable: false },
      ],
    });
    await pay(t1.invoice.id, central.id, t1.patientShare, 'CASH', 0, 3);
    await tx.invoice.update({ where: { id: t1.invoice.id }, data: { status: 'PAID', paidAt: at(0, 3), paymentMethod: 'Cash', patientPaidAmount: t1.patientShare } });

    const t2 = await makeVisit({
      patientIndex: 3, clinicId: central.id, doctorKey: 'resident', dayOffset: 0,
      lines: [
        { description: 'Wound Dressing', amount: DRESSING, serviceIndex: 1 },
        { description: 'Dressing Pack', amount: Number(items.DRESS1.sellPrice), itemCode: 'DRESS1', taxable: false },
      ],
    });
    await pay(t2.invoice.id, central.id, t2.patientShare, 'CASH', 0, 4);
    await tx.invoice.update({ where: { id: t2.invoice.id }, data: { status: 'PAID', paidAt: at(0, 4), paymentMethod: 'Cash', patientPaidAmount: t2.patientShare } });

    const t3 = await makeVisit({
      patientIndex: 4, clinicId: central.id, doctorKey: 'owner', dayOffset: 0,
      lines: [
        { description: 'Suturing (minor)', amount: SUTURE, serviceIndex: 2 },
        { description: 'Metformin 500mg', amount: Number(items.MET500.sellPrice), itemCode: 'MET500', taxable: false },
      ],
    });
    await pay(t3.invoice.id, central.id, t3.patientShare, 'CARD', 0, 5);
    await tx.invoice.update({ where: { id: t3.invoice.id }, data: { status: 'PAID', paidAt: at(0, 5), paymentMethod: 'Credit Card', patientPaidAmount: t3.patientShare } });

    const t4 = await makeVisit({
      patientIndex: 5, clinicId: central.id, doctorKey: 'resident', dayOffset: 0,
      lines: [{ description: 'NCD Review', amount: NCD, serviceIndex: 4 }],
    });
    await pay(t4.invoice.id, central.id, t4.patientShare, 'QR', 0, 6);
    await tx.invoice.update({ where: { id: t4.invoice.id }, data: { status: 'PAID', paidAt: at(0, 6), paymentMethod: 'DuitNow QR', patientPaidAmount: t4.patientShare } });

    const t5 = await makeVisit({
      patientIndex: 6, clinicId: central.id, doctorKey: 'owner', dayOffset: 0,
      lines: [{ description: 'Weight Management Review', amount: WEIGHT, serviceIndex: 5 }],
    });
    await pay(t5.invoice.id, central.id, t5.patientShare, 'QR', 0, 7);
    await tx.invoice.update({ where: { id: t5.invoice.id }, data: { status: 'PAID', paidAt: at(0, 7), paymentMethod: 'DuitNow QR', patientPaidAmount: t5.patientShare } });

    // A BANK TRANSFER, so the "Other" bucket is not a permanently empty field.
    const t6 = await makeVisit({
      patientIndex: 7, clinicId: central.id, doctorKey: 'resident', dayOffset: 0,
      lines: [{ description: 'Antenatal Review', amount: ANTENATAL, serviceIndex: 3 }],
    });
    await pay(t6.invoice.id, central.id, t6.patientShare, 'BANK_TRANSFER', 0, 8);
    await tx.invoice.update({ where: { id: t6.invoice.id }, data: { status: 'PAID', paidAt: at(0, 8), paymentMethod: 'Bank Transfer', patientPaidAmount: t6.patientShare } });

    // THE REFUND. Card, same day, against a visit paid earlier this morning:
    // the patient was charged for a suture kit that was not used. Expected CARD
    // must come out RM40 lower than the card takings, which is the assertion
    // that separates "we netted the refund" from "we listed it somewhere".
    await pay(t3.invoice.id, central.id, 40, 'CARD', 0, 9, 'REFUND', {
      notes: 'Suture kit charged but not used — returned to the card at the counter',
    });
    await tx.invoice.update({ where: { id: t3.invoice.id }, data: { patientPaidAmount: t3.patientShare - 40 } });

    // A PANEL visit today: it bills, it appears in the day's operational
    // figures, and it puts NOTHING in the drawer. A day-end that shows this
    // as expected cash is the classic false shortage.
    const tPanel = await makeVisit({
      patientIndex: 1, clinicId: central.id, doctorKey: 'owner', dayOffset: 0,
      panelIndex: 0,
      lines: [
        { description: 'General Consultation', amount: CONSULT, serviceIndex: 0 },
        { description: 'Metformin 500mg', amount: Number(items.MET500.sellPrice), itemCode: 'MET500', taxable: false },
      ],
    });
    if (tPanel.patientShare > 0) {
      await pay(tPanel.invoice.id, central.id, tPanel.patientShare, 'CASH', 0, 10);
      await tx.invoice.update({ where: { id: tPanel.invoice.id }, data: { patientPaidAmount: tPanel.patientShare } });
    }

    console.log(`  finance: ${visitSeq} visits, cash/card/QR, partial, refund, reversal, 2 credit notes, 1 closed day, 1 OPEN day today`);
    return { note };
  });
}

// ---------------------------------------------------------------------------
// PANEL: the four claim states the brief asks for.
// ---------------------------------------------------------------------------
async function seedPanelClaims(ids: Ids) {
  await withTenant(async (tx) => {
    const { tenant, central, branch, staff, services, panels } = ids;
    const patients = await tx.patient.findMany({ where: { tenantId: tenant.id }, orderBy: { name: 'asc' } });
    const CONSULT = Number(services[0].price);
    const NCD = Number(services[4].price);

    let claimSeq = 0;
    async function panelVisit(panelIndex: number, patientIndex: number, dayOffset: number, amount: number, clinicId: string, doctorKey: string) {
      const panel = panels[panelIndex];
      const patient = patients[patientIndex % patients.length];
      const visit = await tx.visit.create({
        data: {
          tenantId: tenant.id, clinicId, patientId: patient.id,
          visitNumber: `VP-${String(++claimSeq).padStart(6, '0')}`,
          billingType: 'PANEL', panelClinicId: panel.id, panelVerificationStatus: 'VERIFIED',
          registeredByStaffId: staff.counter, staffId: staff[doctorKey],
          createdAt: at(dayOffset, 2), checkInAt: at(dayOffset, 2),
        },
      });
      await tx.diagnosis.create({
        data: { tenantId: tenant.id, visitId: visit.id, name: 'Essential hypertension', priority: 'PRIMARY', addedByStaffId: staff[doctorKey] },
      });
      const invoice = await tx.invoice.create({
        data: {
          tenantId: tenant.id, visitId: visit.id, invoiceNumber: `INVP-${String(claimSeq).padStart(6, '0')}`,
          createdByStaffId: staff.counter, status: 'PAID', paidAt: at(dayOffset, 4), paymentMethod: 'PANEL',
          subtotalAmount: amount, totalAmount: amount,
          panelResponsibilityAmount: amount, patientResponsibilityAmount: 0, panelCoveredAmount: amount,
          createdAt: at(dayOffset, 3),
        },
      });
      // Two lines, both traceable — a panel claim that MediCover would reject
      // for want of itemisation is one of the cases the workspace has to show,
      // but the rest of the panel visits bill a real consultation and a real
      // medicine so the segment and drug-margin reports see panel work too.
      const consult = ids.services[0];
      const consultOrder = await tx.orderService.create({
        data: {
          tenantId: tenant.id, clinicId, visitId: visit.id, serviceCatalogId: consult.id,
          procedureName: consult.name, orderType: 'STANDARD_SERVICE', quantity: 1, status: 'COMPLETED',
          requestedByStaffId: staff[doctorKey], requestedAt: at(dayOffset, 2, 30), completedAt: at(dayOffset, 3),
        },
      });
      const consultPrice = Math.min(Number(consult.price), amount);
      await tx.invoiceLine.create({
        data: {
          tenantId: tenant.id, invoiceId: invoice.id, description: consult.name, quantity: 1,
          unitPrice: consultPrice, amount: consultPrice, sourceOrderServiceId: consultOrder.id,
          createdAt: at(dayOffset, 3),
        },
      });
      const medicineAmount = Math.round((amount - consultPrice) * 100) / 100;
      if (medicineAmount > 0) {
        const medicine = ids.items.AML5;
        const prescription = await tx.prescription.create({
          data: {
            tenantId: tenant.id, visitId: visit.id, itemId: medicine.id, quantity: 1,
            amount: medicineAmount, frequency: 'OD', durationDays: 30, status: 'DISPENSED',
            prescribedByStaffId: staff[doctorKey], prescribedAt: at(dayOffset, 3),
            dispensedByStaffId: staff.counter, dispensedAt: at(dayOffset, 3, 30),
          },
        });
        await postMove(tx, tenant.id, staff.counter, clinicId, medicine.id, -1, 'DISPENSED', {
          referenceType: 'Prescription', referenceId: prescription.id,
        });
        await tx.invoiceLine.create({
          data: {
            tenantId: tenant.id, invoiceId: invoice.id, description: medicine.name, quantity: 1,
            unitPrice: medicineAmount, amount: medicineAmount, sourcePrescriptionId: prescription.id,
            createdAt: at(dayOffset, 3),
          },
        });
      }
      return { visit, invoice, panel };
    }

    /**
     * What the panel owes on a claim, in the direction THAT panel's contract
     * says (G-1). The same arithmetic as `computeClaimBalance`, restated here
     * because the seed writes adjudication figures directly and they have to
     * land on the receivable the engine will compute from the same rows.
     *
     * A NULL direction contributes NO fee, which is what the engine does when
     * nobody has said which way it moves.
     */
    function receivableOf(amount: number, fee: number, treatment: string) {
      const sign =
        treatment === 'ADDED_TO_RECEIVABLE' ? 1 : treatment === 'WITHHELD_FROM_CLAIM' ? -1 : 0;
      return Math.round((amount + sign * fee) * 100) / 100;
    }

    async function claim(panelIndex: number, invoiceId: string, amount: number, dayOffset: number) {
      const panel = panels[panelIndex];
      const fee =
        panel.code === 'MEDICOVER' ? Math.round(amount * 0.08 * 100) / 100 : panel.code === 'SEJAHTERA' ? 5 : 0;
      const batch = await tx.claimBatch.create({
        data: {
          tenantId: tenant.id, panelClinicId: panel.id, batchNumber: nextNumber('CLAIM'),
          createdByStaffId: staff.panel, createdAt: at(dayOffset, 8),
        },
      });
      const line = await tx.claimBatchLine.create({
        data: {
          tenantId: tenant.id, claimBatchId: batch.id, invoiceId,
          claimedAmount: amount, feeAmount: fee,
          // Snapshotted from the panel, exactly as ClaimBatchService does.
          // SEJAHTERA has no direction configured, so its claims carry NULL and
          // their fee stays out of the receivable — the state the UAT set
          // deliberately demonstrates.
          feeTreatment: panel.feeTreatment,
          claimStatus: 'BATCHED', createdAt: at(dayOffset, 8),
        },
      });
      return { batch, line, fee };
    }

    async function submit(batchId: string, lineId: string, dayOffset: number, claimNo: string, termDays: number, fromStatus = 'BATCHED') {
      await tx.claimBatch.update({
        where: { id: batchId },
        data: { status: 'SUBMITTED', submittedAt: at(dayOffset, 9), submissionMethod: 'Portal', submissionReference: claimNo },
      });
      await tx.claimBatchLine.update({
        where: { id: lineId },
        data: {
          claimStatus: 'SUBMITTED', submittedAt: at(dayOffset, 9), panelClaimNo: claimNo,
          dueDate: day(dayOffset + termDays),
        },
      });
      await tx.claimEvent.create({
        data: {
          tenantId: tenant.id, claimBatchLineId: lineId, eventType: 'SUBMITTED',
          fromStatus: fromStatus as never, toStatus: 'SUBMITTED', reference: claimNo,
          reason: `Submitted by ${'Wan Azman'} via PORTAL`, actorStaffId: staff.panel, createdAt: at(dayOffset, 9),
        },
      });
    }

    // 1. PAID IN FULL.
    const paidVisit = await panelVisit(0, 0, -50, 120, central.id, 'owner');
    const paidClaim = await claim(0, paidVisit.invoice.id, 120, -50);
    await submit(paidClaim.batch.id, paidClaim.line.id, -49, 'MC-2026-00101', 30);
    const paidReceivable = receivableOf(120, paidClaim.fee, panels[0].feeTreatment);
    await tx.claimBatchLine.update({
      where: { id: paidClaim.line.id },
      data: { claimStatus: 'PAID', status: 'PAID', approvedAmount: paidReceivable, rejectedAmount: 0, adjudicatedAt: at(-40, 4), paidAmount: paidReceivable, resolvedAt: at(-30, 4) },
    });
    await tx.claimEvent.createMany({
      data: [
        { tenantId: tenant.id, claimBatchLineId: paidClaim.line.id, eventType: 'ADJUDICATED', fromStatus: 'SUBMITTED', toStatus: 'APPROVED', amount: paidReceivable, actorStaffId: staff.panel, createdAt: at(-40, 4) },
        { tenantId: tenant.id, claimBatchLineId: paidClaim.line.id, eventType: 'PAYMENT_RECEIVED', fromStatus: 'APPROVED', toStatus: 'PAID', amount: paidReceivable, reference: 'TRF-2026-8811', actorStaffId: staff.finance, createdAt: at(-30, 4) },
      ],
    });
    const remittance = await tx.panelRemittance.create({
      data: {
        tenantId: tenant.id, panelClinicId: panels[0].id, remittanceRef: 'TRF-2026-8811',
        receivedAt: day(-30), grossAmount: paidReceivable, withheldAmount: 0, netAmount: paidReceivable,
        recordedByStaffId: staff.finance,
        allocations: { create: [{ tenantId: tenant.id, claimBatchLineId: paidClaim.line.id, amount: paidReceivable }] },
      },
    });

    // 2. PARTIALLY APPROVED — approved less than claimed, and PARTIALLY PAID.
    const partialVisit = await panelVisit(0, 1, -40, 220, central.id, 'resident');
    const partialClaim = await claim(0, partialVisit.invoice.id, 220, -40);
    await submit(partialClaim.batch.id, partialClaim.line.id, -39, 'MC-2026-00118', 30);
    // Approved 180 of what was asked; the rest is the rejection. Derived from
    // the receivable rather than typed, so the two always sum to it whichever
    // way this panel's fee moves.
    const partialReceivable = receivableOf(220, partialClaim.fee, panels[0].feeTreatment);
    await tx.claimBatchLine.update({
      where: { id: partialClaim.line.id },
      data: {
        claimStatus: 'PARTIALLY_PAID', status: 'PAID',
        approvedAmount: 180,
        rejectedAmount: Math.round((partialReceivable - 180) * 100) / 100,
        rejectionReason: 'Consultation cap exceeded for this member',
        rejectionCategory: 'PATIENT_LIMIT_EXHAUSTED',
        adjudicatedAt: at(-32, 4), paidAmount: 120,
      },
    });
    await tx.panelRemittance.create({
      data: {
        tenantId: tenant.id, panelClinicId: panels[0].id, remittanceRef: 'TRF-2026-9004',
        receivedAt: day(-20), grossAmount: 120, withheldAmount: 0, netAmount: 120, recordedByStaffId: staff.finance,
        allocations: { create: [{ tenantId: tenant.id, claimBatchLineId: partialClaim.line.id, amount: 120 }] },
      },
    });

    // 3. REJECTED, then RE-CLAIMED under a new number.
    const rejectedVisit = await panelVisit(1, 2, -35, 160, central.id, 'owner');
    const rejectedClaim = await claim(1, rejectedVisit.invoice.id, 160, -35);
    await submit(rejectedClaim.batch.id, rejectedClaim.line.id, -34, 'SJ-2026-0442', 45);
    const rejectedReceivable = receivableOf(160, rejectedClaim.fee, panels[1].feeTreatment);
    await tx.claimBatchLine.update({
      where: { id: rejectedClaim.line.id },
      data: {
        claimStatus: 'RESUBMITTED', status: 'REJECTED',
        approvedAmount: 0, rejectedAmount: rejectedReceivable, rejectionReason: 'Medication not on the member’s formulary',
        rejectionCategory: 'ITEM_NOT_COVERED',
        adjudicatedAt: at(-28, 4), resolvedAt: at(-26, 2), resolutionNote: 'Re-claimed under a new claim number',
      },
    });
    const replacementBatch = await tx.claimBatch.create({
      data: { tenantId: tenant.id, panelClinicId: panels[1].id, batchNumber: nextNumber('CLAIM'), createdByStaffId: staff.panel, createdAt: at(-26, 2) },
    });
    const replacement = await tx.claimBatchLine.create({
      data: {
        tenantId: tenant.id, claimBatchId: replacementBatch.id, invoiceId: rejectedVisit.invoice.id,
        // The re-claim pursues the SAME base amount as the line it supersedes —
        // 160, with the panel's RM5 fee applied exactly once, in whichever
        // direction that panel's contract says. Re-claiming the RECEIVABLE as
        // the new base would quietly move the fee again every time a claim
        // bounces, which over a year of rejections is a real drift.
        claimedAmount: 160, feeAmount: 5, feeTreatment: panels[1].feeTreatment, claimStatus: 'SUBMITTED',
        supersedesLineId: rejectedClaim.line.id, responsibleStaffId: staff.panel,
        panelClaimNo: 'SJ-2026-0517', submittedAt: at(-25, 9), dueDate: day(20),
        remarks: 'Formulary exception approved by the panel by telephone',
        createdAt: at(-26, 2),
      },
    });
    await tx.claimEvent.createMany({
      data: [
        { tenantId: tenant.id, claimBatchLineId: rejectedClaim.line.id, eventType: 'ADJUDICATED', fromStatus: 'SUBMITTED', toStatus: 'REJECTED', amount: 0, reason: 'Medication not on the member’s formulary', actorStaffId: staff.panel, createdAt: at(-28, 4) },
        { tenantId: tenant.id, claimBatchLineId: rejectedClaim.line.id, eventType: 'RESUBMITTED', fromStatus: 'REJECTED', toStatus: 'RESUBMITTED', amount: rejectedReceivable, reference: replacementBatch.batchNumber, actorStaffId: staff.panel, createdAt: at(-26, 2) },
        { tenantId: tenant.id, claimBatchLineId: replacement.id, eventType: 'CREATED_AS_REPLACEMENT', toStatus: 'READY', amount: rejectedReceivable, reason: 'Formulary exception approved by the panel by telephone', actorStaffId: staff.panel, createdAt: at(-26, 2) },
      ],
    });

    // 3b. REJECTED AND STILL AWAITING A DECISION.
    //
    // The claim above was rejected AND re-claimed, which correctly removes both
    // the re-claim and the write-off buttons from it — a second replacement
    // would claim the same money twice. That left the work queue with no row a
    // person could actually act on, so the two decisions this module exists to
    // offer (pursue it again, or stop pursuing it and say why) could not be
    // seen or reviewed.
    //
    // A real panel book always has rejections waiting on somebody. This is one:
    // rejected eleven days ago, nobody has decided yet, and the queue offers
    // both routes out.
    const openRejectVisit = await panelVisit(0, 5, -18, 120, central.id, 'resident');
    const openRejectClaim = await claim(0, openRejectVisit.invoice.id, 120, -18);
    await submit(openRejectClaim.batch.id, openRejectClaim.line.id, -17, 'MC-2026-00204', 30);
    await tx.claimBatchLine.update({
      where: { id: openRejectClaim.line.id },
      data: {
        claimStatus: 'REJECTED', status: 'REJECTED',
        approvedAmount: 0,
        rejectedAmount: receivableOf(120, openRejectClaim.fee, panels[0].feeTreatment),
        rejectionReason: 'Referral letter not attached to the submission',
        rejectionCategory: 'DOCUMENTATION_INCOMPLETE',
        adjudicatedAt: at(-11, 4), responsibleStaffId: staff.panel,
      },
    });
    await tx.claimEvent.create({
      data: {
        tenantId: tenant.id, claimBatchLineId: openRejectClaim.line.id, eventType: 'ADJUDICATED',
        fromStatus: 'SUBMITTED', toStatus: 'REJECTED', amount: 0,
        reason: 'Referral letter not attached to the submission',
        actorStaffId: staff.panel, createdAt: at(-11, 4),
      },
    });

    // 4. SUBMITTED AND OVERDUE — past the panel's own payment term.
    const overdueVisit = await panelVisit(2, 3, -95, 95, branch.id, 'locum');
    const overdueClaim = await claim(2, overdueVisit.invoice.id, 95, -95);
    await submit(overdueClaim.batch.id, overdueClaim.line.id, -94, 'KS-2026-0031', 60);

    // 5. PAID THE FULL AMOUNT DESPITE A WITHHELD FEE.
    //
    // The shape of the two exceptions the owner asked to have investigated
    // rather than averaged away: this panel's fee is WITHHELD, so RM110.40 was
    // expected on a RM120 claim — and RM120 arrived. Finance → Panel money
    // finds it by itself and names it, which is the point: the forensic pass
    // that found two of these in a 2,640-row workbook now runs continuously.
    const fullPayVisit = await panelVisit(0, 6, -60, 120, central.id, 'owner');
    const fullPayClaim = await claim(0, fullPayVisit.invoice.id, 120, -60);
    await submit(fullPayClaim.batch.id, fullPayClaim.line.id, -59, 'MC-2026-00131', 30);
    // The panel adjudicated at the FULL claimed amount — which is precisely why
    // no fee came off. The configured rule expects RM110.40; RM120 arrived, and
    // the gap between the two is the finding Finance now surfaces by itself.
    await tx.claimBatchLine.update({
      where: { id: fullPayClaim.line.id },
      data: {
        claimStatus: 'PAID', status: 'PAID',
        approvedAmount: 120, rejectedAmount: 0, adjudicatedAt: at(-52, 4),
        // The money that actually arrived — the WHOLE claim, fee and all.
        paidAmount: 120, resolvedAt: at(-45, 4),
        remarks: 'Panel remitted the full claimed amount; no admin fee deducted',
      },
    });
    await tx.claimEvent.createMany({
      data: [
        { tenantId: tenant.id, claimBatchLineId: fullPayClaim.line.id, eventType: 'ADJUDICATED', fromStatus: 'SUBMITTED', toStatus: 'APPROVED', amount: 120, actorStaffId: staff.panel, createdAt: at(-52, 4) },
        { tenantId: tenant.id, claimBatchLineId: fullPayClaim.line.id, eventType: 'PAYMENT_RECEIVED', fromStatus: 'APPROVED', toStatus: 'PAID', amount: 120, reference: 'TRF-2026-8790', actorStaffId: staff.finance, createdAt: at(-45, 4) },
      ],
    });
    await tx.panelRemittance.create({
      data: {
        tenantId: tenant.id, panelClinicId: panels[0].id, remittanceRef: 'TRF-2026-8790',
        receivedAt: day(-45), grossAmount: 120, withheldAmount: 0, netAmount: 120,
        notes: 'Full claimed amount received — admin fee not deducted on this payment',
        recordedByStaffId: staff.finance,
        allocations: { create: [{ tenantId: tenant.id, claimBatchLineId: fullPayClaim.line.id, amount: 120 }] },
      },
    });

    // 5b. BILLED TO A PANEL AND NEVER CLAIMED.
    //
    // The clinic's own monthly reconciliation exists to find exactly this: an
    // invoice whose panel share was settled two months ago and for which no
    // claim was ever raised. It appears in NO claim listing anywhere — it is
    // invisible by construction — and it is RM145 of real money.
    await panelVisit(0, 7, -70, 145, central.id, 'resident');

    // 6. AWAITING SUBMISSION — one complete, one missing a diagnosis.
    const readyVisit = await panelVisit(0, 4, -3, NCD + 40, central.id, 'owner');
    await claim(0, readyVisit.invoice.id, NCD + 40, -3);

    const incompleteVisit = await tx.visit.create({
      data: {
        tenantId: tenant.id, clinicId: branch.id, patientId: patients[5].id,
        visitNumber: `VP-${String(++claimSeq).padStart(6, '0')}`, billingType: 'PANEL',
        panelClinicId: panels[0].id, panelVerificationStatus: 'VERIFIED',
        registeredByStaffId: staff.counter2, staffId: staff.locum, createdAt: at(-2, 2),
      },
    });
    const incompleteInvoice = await tx.invoice.create({
      data: {
        tenantId: tenant.id, visitId: incompleteVisit.id, invoiceNumber: `INVP-${String(claimSeq).padStart(6, '0')}`,
        createdByStaffId: staff.counter2, status: 'PAID', paymentMethod: 'PANEL',
        subtotalAmount: CONSULT, totalAmount: CONSULT,
        panelResponsibilityAmount: CONSULT, patientResponsibilityAmount: 0, panelCoveredAmount: CONSULT,
        createdAt: at(-2, 3),
      },
    });
    // NO invoice lines and NO diagnosis: MediCover requires itemisation, so the
    // readiness check has a real failure to report.
    await claim(0, incompleteInvoice.id, CONSULT, -2);

    console.log(
      '  panel: paid, partially paid, rejected→re-claimed, rejected→awaiting decision, overdue, fee-not-taken, never-claimed, ready, incomplete',
    );
    void remittance;
  });
}

// ---------------------------------------------------------------------------
// WORKFORCE: employees, attendance with overtime, leave, an incentive run and
// a payroll run — with NO statutory rates configured, deliberately.
// ---------------------------------------------------------------------------
async function seedWorkforce(ids: Ids) {
  await withTenant(async (tx) => {
    const { tenant, central, branch, staff, services } = ids;

    const policy = await tx.leavePolicy.create({
      data: {
        tenantId: tenant.id, name: 'Standard — permanent staff', carryForwardDays: 5, proRateOnJoin: true,
        entitlements: {
          create: [
            { tenantId: tenant.id, leaveType: 'ANNUAL', daysPerYear: 14, paid: true },
            { tenantId: tenant.id, leaveType: 'MEDICAL', daysPerYear: 14, paid: true, requiresAttachment: true },
            { tenantId: tenant.id, leaveType: 'EMERGENCY', daysPerYear: 3, paid: true },
            { tenantId: tenant.id, leaveType: 'UNPAID', daysPerYear: 0, paid: false },
          ],
        },
      },
    });

    // DATE OF BIRTH IS PAYROLL DATA, not demographics: EPF, SOCSO and EIS all
    // change at 60, so an employee without one cannot be calculated. Hafiz is
    // deliberately 61 so the 60+ branch is exercised by the seeded run —
    // employee EPF nil, employer 4%, SOCSO Second Category, no EIS.
    // --- STAGE 1: the employer, the catalogue and the policy ---------------
    //
    // A branch employs nobody and files nothing. These three exist so the
    // Stage 1 screens have something real to show and so the payroll run has
    // an employer to belong to.
    //
    // TWO EMPLOYERS, on purpose. One complete enough to file with, one that is
    // not — the "Could it file?" column is the whole point of that screen and a
    // fixture where every row is green tests nothing. The second also proves
    // the group case the audited competitor cannot represent at all: two Sdn
    // Bhds under one account.
    const employer = await tx.legalEmployer.create({
      data: {
        tenantId: tenant.id,
        name: 'Klinik Contoh Sdn Bhd',
        registrationNo: '202601000001',
        epfEmployerNo: 'E-0001-0001',
        socsoEmployerNo: 'A1234567890',
        lhdnEmployerNo: 'E 1234567890',
        addressLine1: '12 Jalan Contoh',
        postcode: '43000',
        city: 'Kajang',
        state: 'Selangor',
        bankName: 'Bank Contoh',
        bankAccountNo: '5551234567',
        bankAccountName: 'KLINIK CONTOH SDN BHD',
      },
    });
    const secondEmployer = await tx.legalEmployer.create({
      data: {
        tenantId: tenant.id,
        name: 'Contoh Wellness Sdn Bhd',
        registrationNo: '202601000002',
        epfEmployerNo: 'E-0002-0001',
        // SOCSO and LHDN deliberately absent: nothing could be filed for the
        // people employed here, and the screen has to say so before a payroll
        // run makes it somebody's problem.
        addressLine1: '4 Jalan Sihat',
        city: 'Kajang',
        state: 'Selangor',
      },
    });

    // HRD CORP REGISTRATION, DATED — and the levy RATE is not stored beside it:
    // 1% (s.14) and 0.5% (s.15) are the PSMB Act's numbers, derived from the
    // class. The main company is above the section 14 headcount; the second is
    // not registered, so the UAT clinic shows both answers.
    await tx.legalEmployerStatutoryProfile.createMany({
      data: [
        {
          tenantId: tenant.id,
          legalEmployerId: employer.id,
          hrdRegistration: 'MANDATORY_SECTION_14',
          effectiveFrom: day(-720),
          reason: 'Registered under section 14',
        },
        {
          tenantId: tenant.id,
          legalEmployerId: secondEmployer.id,
          hrdRegistration: 'NOT_REGISTERED',
          effectiveFrom: day(-720),
          reason: 'Below the section 14 headcount and has not opted in',
        },
      ],
    });

    // The 15 components the engine knows, as rows. Every flag UNVERIFIED —
    // seeding a catalogue is not the same as checking one.
    for (const component of SEED_PAY_COMPONENTS) {
      await tx.payComponent.create({
        data: {
          tenantId: tenant.id,
          code: component.code,
          name: component.name,
          type: component.type,
          category: component.category,
          includeIn: component.includeIn,
          pcbLiable: component.pcbLiable,
          epfLiable: component.epfLiable,
          socsoLiable: component.socsoLiable,
          eisLiable: component.eisLiable,
          hrdLiable: component.hrdLiable,
          includeInOrpBase: component.includeInOrpBase,
          includeInUnpaidLeaveBase: component.includeInUnpaidLeaveBase,
          additionalRemuneration: component.additionalRemuneration,
          prorated: component.prorated,
          employerSide: component.employerSide,
          systemControlled: true,
          // DRAFT, not CORROBORATED and certainly not VERIFIED. Nobody has
          // checked a single one of these flags against KWSP, PERKESO or HASiL.
          verificationStatus: 'DRAFT',
          effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
        },
      });
    }

    await tx.payrollPolicy.create({
      data: {
        tenantId: tenant.id,
        legalEmployerId: employer.id,
        name: 'Klinik Contoh standard',
        overtimeDays: 26,
        overtimeHoursPerDay: 7.5,

        isDefault: true,
      },
    });

    /*
     * §6 PLACEHOLDER (Piece 3d). Doctors are paid a fixed RM500 a public-holiday
     * shift — a clinic rate, above the First Schedule so no floor applies —
     * and everybody else stays on the Act through the default rule set above.
     * The owner replaces the figure in Settings › Payroll policies; the seed
     * only has to show the two modes side by side.
     */
    await tx.payrollPolicy.create({
      data: {
        tenantId: tenant.id,
        legalEmployerId: null,
        name: 'Doctors',
        workforceCategory: 'DOCTOR',
        overtimeMode: 'CLINIC_RATE',
        clinicPublicHolidayShift: 500,
        overtimeDays: 26,
        overtimeHoursPerDay: 7.5,

        isDefault: false,
      },
    });

    /*
     * `contractor` IS THE FIELD THAT KEEPS SOMEBODY OUT OF PAYROLL.
     *
     * It did not exist here, so every profile took the schema default of
     * EMPLOYEE — including the locum, whose whole purpose in this world is to
     * demonstrate that a contractor is a Finance PAYABLE and never a payslip.
     * The seeded world was quietly asserting the opposite of the rule the
     * product enforces.
     */
    const profiles: {
      key: string;
      position: string;
      salary: number | null;
      type: 'PERMANENT' | 'LOCUM' | 'CONTRACT';
      born: [number, number, number];
      contractor?: true;
    }[] = [
      { key: 'owner', position: 'Principal Doctor / Owner', salary: 18000, type: 'PERMANENT', born: [1981, 3, 14] },
      { key: 'resident', position: 'Resident Medical Officer', salary: 9500, type: 'PERMANENT', born: [1990, 8, 2] },
      // A CONTRACTOR. Paid per session through Finance, never through payroll.
      { key: 'locum', position: 'Locum Doctor', salary: null, type: 'LOCUM', born: [1988, 11, 30], contractor: true },
      { key: 'counter', position: 'Senior Clinic Assistant', salary: 3200, type: 'PERMANENT', born: [1995, 5, 19] },
      { key: 'counter2', position: 'Clinic Assistant', salary: 2600, type: 'PERMANENT', born: [1999, 1, 7] },
      { key: 'stock', position: 'Stock Controller', salary: 2900, type: 'PERMANENT', born: [1964, 6, 11] },
      { key: 'finance', position: 'Finance Executive', salary: 4200, type: 'PERMANENT', born: [1992, 9, 23] },
      // Deliberately WITHOUT a salary: the payroll run must surface this person
      // as an exception rather than paying them nothing.
      { key: 'panel', position: 'Panel Claims Executive', salary: null, type: 'CONTRACT', born: [1993, 2, 5] },
      { key: 'manager', position: 'Clinic Manager', salary: 5600, type: 'PERMANENT', born: [1986, 4, 8] },
      { key: 'nurse', position: 'Staff Nurse', salary: 3400, type: 'PERMANENT', born: [1993, 10, 21] },
      { key: 'pharm', position: 'Pharmacy Assistant', salary: 2750, type: 'PERMANENT', born: [1997, 7, 3] },
      { key: 'accounts', position: 'Accounts Assistant', salary: 3100, type: 'PERMANENT', born: [1994, 0, 16] },
    ];

    for (const [index, profile] of profiles.entries()) {
      await tx.employeeProfile.create({
        data: {
          tenantId: tenant.id, staffId: staff[profile.key],
          employeeNo: `E-${String(1001 + index)}`,
          position: profile.position,
          department:
            profile.key.startsWith('counter')
              ? 'Front Office'
              : profile.key === 'stock' || profile.key === 'pharm'
                ? 'Pharmacy'
                : profile.key === 'finance' || profile.key === 'accounts'
                  ? 'Finance'
                  : profile.key === 'manager'
                    ? 'Administration'
                    : 'Clinical',
          employmentType: profile.type,
          // The one field that decides payroll or payable. See `profiles`.
          engagement: profile.contractor ? 'CONTRACTOR' : 'EMPLOYEE',
          employmentStatus: 'ACTIVE',
          // EMPLOYED BY the employer, WORKS AT the branch. The locum sits under
          // the second entity, so the group case is visible and so the
          // "could it file?" gap has somebody standing behind it.
          legalEmployerId: profile.key === 'locum' ? secondEmployer.id : employer.id,
          startDate: day(-500 - index * 30),
          dateOfBirth: new Date(Date.UTC(profile.born[0], profile.born[1], profile.born[2])),
          basicSalary: profile.salary,
          hourlyRate: profile.type === 'LOCUM' ? 120 : null,
          leavePolicyId: policy.id,
          managerStaffId: profile.key === 'owner' ? null : staff.owner,
          phone: `013-200000${index}`,
          email: `${profile.key}@${DOMAIN}`,
          bankName: 'Bank Contoh',
          bankAccountNo: `1234567${index}`,
        },
      });

      // --- STATUTORY STANDING, WITH A DATE ON IT ---------------------------
      //
      // These were columns on the profile above. A column is edited; a
      // classification CHANGED, on a day, and every unapproved period before
      // that day must keep using what was true then. Dated from hire so the
      // whole UAT year resolves one version.
      //
      // SYNTHETIC, like every other fact in this seed. All Malaysian citizens,
      // which makes the stock controller (born 1964, so past 60) a Part E
      // employee — employer 4%, employee nil — and therefore a visible
      // demonstration that the age cliff is real rather than a rate tweak.
      await tx.employeeStatutoryClassification.create({
        data: {
          tenantId: tenant.id,
          staffId: staff[profile.key],
          effectiveFrom: day(-500 - index * 30),
          epfMembership: 'MALAYSIAN_CITIZEN',
          // s.59 — the designated rest day. Sunday for everybody in this
          // synthetic clinic. Without it, anybody who worked blocks the run,
          // because a rest day priced as an ordinary day is an underpayment.
          restDayOfWeek: 0,
          // LINDUNG 24 JAM, synthetic like everything else. The locum is the
          // foreign worker, for whom it is mandatory; one clinic assistant has
          // declined, so the UAT clinic shows all three answers rather than a
          // uniform one that proves nothing.
          lindungParticipation:
            profile.key === 'locum'
              ? 'MANDATORY_FOREIGN_WORKER'
              : profile.key === 'counter2'
                ? 'NOT_PARTICIPATING'
                : 'ENROLLED',
          // THE MTD PROFILE — for MOST of the clinic. The three the UAT
          // journey "fixes the legitimate way" (both clinic assistants and
          // the stock keeper) genuinely have none recorded, so the run's
          // PCB-missing blockers are true of the records behind them; the
          // seed used to write RESIDENT for everybody while still raising
          // the blockers, a world that contradicted itself and healed into a
          // different story on the first recalculate.
          ...(['counter', 'counter2', 'stock'].includes(profile.key)
            ? {}
            : {
                taxResidence: 'RESIDENT',
                pcbCategory: profile.key === 'owner' ? 'CATEGORY_2' : 'CATEGORY_1',
                qualifyingChildren: profile.key === 'owner' ? 2 : 0,
              }),
          epfApplicable: profile.type !== 'LOCUM',
          socsoApplicable: profile.type !== 'LOCUM',
          eisApplicable: profile.type !== 'LOCUM',
          reason: 'Recorded at hire',
        },
      });

      // THE EMPLOYER-SELECTED EPF BASIS, demonstrated on one employee. The
      // resident doctor's contract says EPF on basic and the monthly
      // incentive — which is also everything the assessment marks liable in
      // her months, so the world stays clean and approvable while the panel,
      // the deductions row and the snapshot all have a real selection to
      // show. Everyone else has no row: the assessment governs alone, which
      // is the default worth demonstrating too.
      if (profile.key === 'resident') {
        await tx.employeeContributionBasis.create({
          data: {
            tenantId: tenant.id,
            staffId: staff[profile.key],
            scheme: 'EPF',
            mode: 'BASIC_PLUS_SELECTED',
            includedComponentCodes: ['INCENTIVE'],
            effectiveFrom: day(-400),
            reason: 'Contract states EPF on basic salary and the monthly incentive',
            createdByStaffId: staff.owner,
          },
        });
      }

      // --- STAGE 1: the salary, WITH A DATE ON IT -------------------------
      //
      // `employee_profiles.basic_salary` is the figure the old engine read.
      // These rows are the effective-dated record that replaces it: a raise
      // closes the previous row rather than overwriting it, so a payroll run
      // for an earlier month still resolves the rate that was in force then.
      if (profile.salary !== null) {
        // ONE PERSON HAS A HISTORY, so the screen shows a closed row above an
        // open one rather than a single line that could have been a column on
        // the employee form. The senior clinic assistant was on 2,900 until a
        // review six months ago.
        const raised = profile.key === 'counter';
        if (raised) {
          await tx.employeeSalary.create({
            data: {
              tenantId: tenant.id, staffId: staff[profile.key], basis: 'MONTHLY',
              amount: 2900,
              effectiveFrom: day(-400),
              effectiveTo: day(-181),
              reason: 'Starting salary on appointment',
              createdByStaffId: staff.owner,
            },
          });
        }
        await tx.employeeSalary.create({
          data: {
            tenantId: tenant.id, staffId: staff[profile.key], basis: 'MONTHLY',
            amount: profile.salary,
            effectiveFrom: raised ? day(-180) : day(-500 - index * 30),
            reason: raised ? 'Annual review — moved to senior assistant' : 'Starting salary on appointment',
            createdByStaffId: staff.owner,
          },
        });
      } else if (profile.type === 'LOCUM') {
        // A locum is paid by the hour, and the basis is part of the record.
        await tx.employeeSalary.create({
          data: {
            tenantId: tenant.id, staffId: staff[profile.key], basis: 'HOURLY',
            amount: 120,
            effectiveFrom: day(-500 - index * 30),
            reason: 'Locum session rate',
            createdByStaffId: staff.owner,
          },
        });
      }
      // The panel claims executive gets NO salary row at all — that absence is
      // what the payroll run's blocking exception is about.
    }

    /*
     * RECURRING ITEMS (Piece 3c/3d) on the resident doctor's record, as
     * employee-record.html shows them: a housing allowance and a phone
     * allowance in force, and an advance recovery dated for later in the
     * year. The run carries the ones in force into each month as RECURRING
     * inputs; the seeded August lines below predate that and are what the
     * engine wrote before the items existed, so the first recalculation on
     * screen adds RM900 to the resident's gross — deliberately visible.
     */
    for (const item of [
      { componentCode: 'ALLOWANCE', label: 'housing', amount: 800, effectiveFrom: new Date(Date.UTC(2025, 3, 1)), effectiveTo: null, note: 'Per employment contract' },
      { componentCode: 'ALLOWANCE', label: 'phone', amount: 100, effectiveFrom: new Date(Date.UTC(2026, 0, 1)), effectiveTo: null, note: null },
      {
        componentCode: 'ADVANCE_RECOVERY',
        label: 'Salary advance, 4 instalments',
        amount: 200,
        effectiveFrom: new Date(Date.UTC(2026, 8, 1)),
        effectiveTo: new Date(Date.UTC(2026, 11, 1)),
        note: 'RM800 advanced in August 2026',
      },
    ]) {
      await tx.employeeRecurringItem.create({
        data: { tenantId: tenant.id, staffId: staff.resident, createdByStaffId: staff.owner, ...item },
      });
    }

    // --- STAGE 2.5: locum sessions — a payable, never a payslip ------------
    //
    // Dr Faiz is engaged as a CONTRACTOR, so his work must never reach a
    // payroll run. Three states, so the screen shows the whole workflow rather
    // than one row: work not yet done, a fee waiting for a decision, and a fee
    // approved and settled by Finance under its own reference.
    const locumSessions: {
      offset: number;
      label: string;
      hours: number;
      status: 'PLANNED' | 'COMPLETED' | 'APPROVED';
      approved?: number;
      invoice?: string;
    }[] = [
      { offset: 3, label: 'Saturday clinic', hours: 6, status: 'PLANNED' },
      { offset: -4, label: 'Evening session', hours: 4, status: 'COMPLETED' },
      { offset: -11, label: 'Weekend cover', hours: 8, status: 'APPROVED', approved: 960, invoice: 'PV-2026-0088' },
    ];
    for (const session of locumSessions) {
      await tx.locumSession.create({
        data: {
          tenantId: tenant.id,
          clinicId: branch.id,
          staffId: staff.locum,
          sessionDate: day(session.offset),
          label: session.label,
          hours: session.hours,
          hourlyRate: 120,
          status: session.status,
          approvedAmount: session.approved ?? null,
          approvedByStaffId: session.approved ? staff.owner : null,
          approvedAt: session.approved ? at(session.offset + 1, 10) : null,
          payoutStatus: session.invoice ? 'PAID' : 'PENDING',
          invoiceReference: session.invoice ?? null,
          paidAt: session.invoice ? at(session.offset + 3, 10) : null,
          createdByStaffId: staff.owner,
        },
      });
    }

    // --- STAGE 2.5: staff claims — one payment route each -----------------
    //
    // The point of the screen is the route, so the seed shows all three states
    // it can be in: undecided, being paid with salary, and reimbursed by
    // Finance. A claim in the last two states can never move to the other.
    const claims: {
      key: string;
      category: 'MEDICAL' | 'TRAVEL' | 'TRAINING';
      claimed: number;
      approved?: number;
      route?: 'PAYROLL' | 'FINANCE';
      offset: number;
      description: string;
      reference?: string;
    }[] = [
      {
        key: 'counter2', category: 'MEDICAL', claimed: 86.4, approved: 86.4, route: 'PAYROLL', offset: -12,
        description: 'Clinic visit for a work-related injury',
      },
      {
        key: 'stock', category: 'TRAVEL', claimed: 240, approved: 180, route: 'FINANCE', offset: -18,
        description: 'Taxi to the supplier warehouse and back, two trips',
        reference: 'PV-2026-0091',
      },
      {
        key: 'finance', category: 'TRAINING', claimed: 450, offset: -3,
        description: 'Payroll compliance workshop, half day',
      },
    ];
    for (const claim of claims) {
      const decided = claim.approved !== undefined;
      const created = await tx.staffClaim.create({
        data: {
          tenantId: tenant.id,
          clinicId: central.id,
          staffId: staff[claim.key],
          category: claim.category,
          amountClaimed: claim.claimed,
          amountApproved: claim.approved ?? null,
          claimDate: day(claim.offset),
          description: claim.description,
          status: decided ? 'APPROVED' : 'SUBMITTED',
          submittedByStaffId: staff[claim.key],
          submittedAt: at(claim.offset + 1, 9),
          decidedByStaffId: decided ? staff.owner : null,
          decidedAt: decided ? at(claim.offset + 2, 11) : null,
          paymentRoute: claim.route ?? null,
          payoutStatus: claim.reference ? 'PAID' : 'PENDING',
          payrollPeriod:
            claim.route === 'PAYROLL'
              ? new Date(Date.UTC(day(claim.offset).getUTCFullYear(), day(claim.offset).getUTCMonth(), 1))
              : null,
          financeReference: claim.reference ?? null,
          paidAt: claim.reference ? at(claim.offset + 5, 15) : null,
        },
      });
      await tx.staffClaimEvent.create({
        data: {
          tenantId: tenant.id, staffClaimId: created.id, event: 'submitted',
          detail: `${claim.category} claim for RM${claim.claimed.toFixed(2)}`,
          toStatus: 'SUBMITTED', actorStaffId: staff[claim.key], createdAt: at(claim.offset + 1, 9),
        },
      });
      if (decided) {
        await tx.staffClaimEvent.create({
          data: {
            tenantId: tenant.id, staffClaimId: created.id, event: 'approved',
            detail: `RM${claim.approved!.toFixed(2)} approved, paid via ${claim.route}`,
            fromStatus: 'SUBMITTED', toStatus: 'APPROVED', actorStaffId: staff.owner,
            createdAt: at(claim.offset + 2, 11),
          },
        });
      }
      if (claim.reference) {
        await tx.staffClaimEvent.create({
          data: {
            tenantId: tenant.id, staffClaimId: created.id, event: 'settled',
            detail: `Reimbursed by Finance under ${claim.reference}`,
            actorStaffId: staff.finance, createdAt: at(claim.offset + 5, 15),
          },
        });
      }
    }

    // --- Attendance across the current month ------------------------------
    //
    // EVERYBODY WHO PUNCHES, not a sample of four. With four, the attendance
    // sheet showed three rows out of eight employees and read as a clinic where
    // most people never come in — which is not a state worth reviewing a design
    // against. Doctors clock in too; the panel executive is office-based like
    // Finance.
    const attendanceStaff = ['counter', 'counter2', 'stock', 'finance', 'resident', 'panel', 'owner'];
    // Walk back only as far as the 1st. A fixed twenty-day lookback spends the
    // first three weeks of every month writing attendance into the PREVIOUS
    // one, where the timesheet's default window cannot see it.
    const oldestAttendance = Math.max(-20, -(new Date().getUTCDate() - 1));
    for (let offset = oldestAttendance; offset <= -1; offset += 1) {
      const weekday = day(offset).getUTCDay();
      if (weekday === 0) continue; // closed Sunday
      for (const [index, key] of attendanceStaff.entries()) {
        const late = offset % 7 === 0 && index === 1;
        const overtime = offset % 5 === 0 && index === 0;
        const clockIn = at(offset, 1, late ? 22 : 0);
        const clockOut = at(offset, overtime ? 11 : 9, 0);
        const workedMinutes = Math.round((clockOut.getTime() - clockIn.getTime()) / 60000);
        await tx.attendanceRecord.create({
          data: {
            tenantId: tenant.id, staffId: staff[key],
            clinicId: key === 'counter2' ? branch.id : central.id,
            workDate: day(offset),
            clockInAt: clockIn, clockOutAt: clockOut,
            scheduledStart: at(offset, 1), scheduledEnd: at(offset, 9),
            status: late ? 'LATE' : 'PRESENT',
            lateMinutes: late ? 17 : 0,
            earlyOutMinutes: 0,
            workedMinutes,
            overtimeMinutes: overtime ? 120 : 0,
            // Some approved, some not — so the timesheet shows both columns.
            overtimeApproved: overtime && offset < -10,
            overtimeApprovedByStaffId: overtime && offset < -10 ? staff.owner : null,
          },
        });
      }
    }

    // TODAY, so the "who is working right now" screen has a today to show.
    //
    // The loop above stops at yesterday, which left every figure on the HR
    // landing page reading zero — a screen whose whole job is answering "who
    // is here?" cannot be reviewed when the honest answer is "nobody, ever".
    // Three people in: two still on the floor (clocked in, no clock-out), one
    // who has gone home, and one of the two arrived late.
    await tx.attendanceRecord.create({
      data: {
        tenantId: tenant.id, staffId: staff.counter, clinicId: central.id, workDate: day(0),
        clockInAt: at(0, 1), clockOutAt: null, status: 'PRESENT',
        scheduledStart: at(0, 1), scheduledEnd: at(0, 9), lateMinutes: 0,
      },
    });
    await tx.attendanceRecord.create({
      data: {
        tenantId: tenant.id, staffId: staff.stock, clinicId: central.id, workDate: day(0),
        clockInAt: at(0, 1, 24), clockOutAt: null, status: 'LATE',
        scheduledStart: at(0, 1), scheduledEnd: at(0, 9), lateMinutes: 24,
      },
    });
    // AND ONE UNAPPROVED OVERTIME, TODAY.
    //
    // The loop above puts unapproved overtime five and ten days back, which is
    // in this month for most of a month and in the previous one early in it. On
    // the 1st the loop does not run at all. Overtime that nobody has approved
    // is the whole subject of the timesheet screen, so it has to be there on
    // every day of every month — and "somebody stayed late today and nobody has
    // signed it off yet" is the most realistic form of it anyway.
    await tx.attendanceRecord.create({
      data: {
        tenantId: tenant.id, staffId: staff.finance, clinicId: central.id, workDate: day(0),
        clockInAt: at(0, 0, 30), clockOutAt: at(0, 10, 30), workedMinutes: 600, status: 'PRESENT',
        scheduledStart: at(0, 1), scheduledEnd: at(0, 9),
        overtimeMinutes: 120,
        overtimeApproved: false,
      },
    });

    // THE ROSTER FOR THIS MONTH, not just for today.
    //
    // Only today was rostered, which meant HR ▸ Roster — the screen whose whole
    // claim is that there is ONE shift table and this is it — opened on a month
    // grid reading "no provider is on the monthly roster yet". A screen that
    // proves a shared roster by showing an empty one proves nothing.
    //
    // Fourteen days back and seven forward, weekdays only, two providers on
    // staggered shifts. Written through the SAME `providerShift` table the
    // Appointments calendar books against — there is no HR-only schedule here
    // and this loop is not creating one.
    // ROSTER_LINKED, not the default FIXED_WEEKLY. A provider on a standing
    // weekly pattern is not "on the monthly roster", and the board correctly
    // said so over a month that had 49 shifts in it — the shifts were real,
    // the doctors just were not the kind of provider that board is about.
    // Both modes exist for a reason; this seed needs the one the board shows.
    await tx.staff.updateMany({
      where: { id: { in: [staff.owner, staff.resident, staff.locum] } },
      data: { appointmentScheduleMode: 'ROSTER_LINKED' },
    });

    for (let offset = -14; offset <= 7; offset += 1) {
      const date = day(offset);
      const weekday = date.getUTCDay();
      if (weekday === 0 || weekday === 6) {
        // A WEEKEND SESSION, one provider, shorter hours. Without it the pack
        // regenerated on a Saturday or Sunday photographed HR ▸ Today reading
        // "Nobody is rostered" — honest for a clinic that shuts at the weekend,
        // but useless as a demonstration of a screen whose entire subject is
        // today, and indistinguishable from the screen being broken. A weekend
        // morning session is also how most Malaysian GP clinics actually run.
        await tx.providerShift.create({
          data: {
            tenantId: tenant.id, clinicId: central.id, staffId: staff.owner,
            shiftDate: date, startsAt: at(offset, 1), endsAt: at(offset, 5),
            note: 'Weekend session',
          },
        });
        continue;
      }
      for (const [index, key] of ['owner', 'resident'].entries()) {
        await tx.providerShift.create({
          data: {
            tenantId: tenant.id, clinicId: central.id, staffId: staff[key],
            shiftDate: date, startsAt: at(offset, 1 + index), endsAt: at(offset, 9 + index),
          },
        });
      }
      // The locum covers the branch on Tuesdays and Thursdays only, so the
      // board shows an uneven week rather than two identical rows.
      if (weekday === 2 || weekday === 4) {
        await tx.providerShift.create({
          data: {
            tenantId: tenant.id, clinicId: branch.id, staffId: staff.locum,
            shiftDate: date, startsAt: at(offset, 2), endsAt: at(offset, 10),
          },
        });
      }
    }

    // TWO CUSTOM ROLES, so Roles & Access is not an empty table.
    //
    // Both are real shapes a clinic asks for and neither carries clinical
    // authority — which is the rule that screen exists to state: writing notes,
    // prescribing and signing come only from the built-in Doctor and Clinical
    // staff roles with their credential checks, and a custom role can carry
    // everything else.
    const branchManager = await tx.clinicCustomRole.create({
      data: {
        tenantId: tenant.id,
        name: 'Branch Manager',
        description: 'Runs one branch day to day: stock, the drawer, the panel queue and the roster.',
        permissions: [
          'stock.view', 'stock.transfer', 'stock.take.count', 'analytics.view',
          'dayEnd.count', 'panel.view', 'panel.claim.submit', 'hr.view',
        ],
        createdByStaffId: staff.owner,
      },
    });
    const claimsClerk = await tx.clinicCustomRole.create({
      data: {
        tenantId: tenant.id,
        name: 'Panel Claims Clerk',
        description: 'Prepares, submits and chases panel claims. Cannot write off a receivable.',
        permissions: ['panel.view', 'panel.claim.submit', 'panel.claim.manage', 'finance.view'],
        createdByStaffId: staff.owner,
      },
    });
    await tx.staffRoleAssignment.create({
      data: { tenantId: tenant.id, staffId: staff.stock, customRoleId: branchManager.id, assignedByStaffId: staff.owner },
    });
    await tx.staffRoleAssignment.create({
      data: { tenantId: tenant.id, staffId: staff.panel, customRoleId: claimsClerk.id, assignedByStaffId: staff.owner },
    });

    // --- ATTENDANCE INSIDE THE PAYROLL PERIOD -----------------------------
    //
    // The payroll run is for LAST month, and a payroll run for a month with no
    // attendance in it is a run nobody can check. These two days are also what
    // make the run's warning exceptions TRUE rather than decorative: one person
    // claimed overtime nobody has approved, one has a day with no clock-out.
    const payrollPeriodDay = (dayOfMonth: number) => {
      const period = monthStart(-1);
      return new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth(), dayOfMonth));
    };
    const periodAt = (dayOfMonth: number, hour: number, minute = 0) =>
      new Date(payrollPeriodDay(dayOfMonth).getTime() + hour * 3600000 + minute * 60000);

    await tx.attendanceRecord.create({
      data: {
        tenantId: tenant.id, staffId: staff.counter, clinicId: central.id,
        workDate: payrollPeriodDay(12),
        clockInAt: periodAt(12, 1), clockOutAt: periodAt(12, 12), workedMinutes: 660,
        scheduledStart: periodAt(12, 1), scheduledEnd: periodAt(12, 9),
        status: 'PRESENT',
        overtimeMinutes: 180,
        // Claimed, not approved. This is the run's UNAPPROVED_OVERTIME warning.
        overtimeApproved: false,
      },
    });
    await tx.attendanceRecord.create({
      data: {
        tenantId: tenant.id, staffId: staff.counter2, clinicId: branch.id,
        workDate: payrollPeriodDay(18),
        clockInAt: periodAt(18, 1), clockOutAt: null, status: 'MISSING_PUNCH',
        scheduledStart: periodAt(18, 1), scheduledEnd: periodAt(18, 9),
      },
    });

    // A MISSING PUNCH, and a CORRECTED record.
    await tx.attendanceRecord.create({
      data: {
        tenantId: tenant.id, staffId: staff.stock, clinicId: central.id, workDate: day(-21),
        clockInAt: at(-21, 1), clockOutAt: null, status: 'MISSING_PUNCH',
        scheduledStart: at(-21, 1), scheduledEnd: at(-21, 9),
      },
    });
    await tx.attendanceRecord.create({
      data: {
        tenantId: tenant.id, staffId: staff.counter, clinicId: central.id, workDate: day(-22),
        clockInAt: at(-22, 1), clockOutAt: at(-22, 9), workedMinutes: 480, status: 'PRESENT',
        originalClockInAt: at(-22, 3), correctedAt: at(-21, 2), correctedByStaffId: staff.owner,
        correctionReason: 'Badge reader was offline; CCTV confirms a 09:00 arrival',
      },
    });

    /*
     * ONE DAY WORKED AS FOUR PUNCHES — the clinic's actual pattern.
     *
     * The counter staff clock out at lunch and back in, deliberately, so the
     * owner can see who left and came back late. Every other day above is one
     * stretch, and a demo world with no four-punch day in it cannot show the
     * thing the timesheet was rebuilt for.
     *
     * 09:02 to 13:01, away for an hour and eleven minutes, 14:12 to 18:03 —
     * 7.8 hours, not the 9.0 that the first punch to the last would report.
     */
    // The loop above already wrote this person a day here on any weekday, and
    // a second record for one person on one date is what the unique key
    // forbids — so this REPLACES that day rather than adding to it.
    const lunchWhen = day(-2);
    const lunchFields = {
      clinicId: central.id,
      clockInAt: at(-2, 1, 2),
      clockOutAt: at(-2, 10, 3),
      workedMinutes: 470,
      status: 'PRESENT' as const,
      scheduledStart: at(-2, 1),
      scheduledEnd: at(-2, 9),
      overtimeMinutes: 0,
      overtimeApproved: false,
      overtimeApprovedByStaffId: null,
      lateMinutes: 0,
    };
    const lunchExisting = await tx.attendanceRecord.findFirst({
      where: { tenantId: tenant.id, staffId: staff.counter, workDate: lunchWhen },
      select: { id: true },
    });
    const lunchDay = lunchExisting
      ? await tx.attendanceRecord.update({ where: { id: lunchExisting.id }, data: lunchFields })
      : await tx.attendanceRecord.create({
          data: { tenantId: tenant.id, staffId: staff.counter, workDate: lunchWhen, ...lunchFields },
        });
    for (const [minutesFromNine, kind] of [
      [2, 'IN'],
      [241, 'OUT'],
      [312, 'IN'],
      [543, 'OUT'],
    ] as [number, 'IN' | 'OUT'][]) {
      await tx.attendancePunch.create({
        data: {
          tenantId: tenant.id,
          attendanceRecordId: lunchDay.id,
          staffId: staff.counter,
          at: new Date(at(-2, 1).getTime() + minutesFromNine * 60_000),
          kind,
          source: 'PORTAL',
        },
      });
    }

    /*
     * EVERY OTHER DAY GETS ITS TWO PUNCHES, derived the same way the migration
     * backfilled the days that already existed.
     *
     * Written HERE rather than at each of the dozen `attendanceRecord.create`
     * calls above: one pass that reads the record cannot drift from it, and a
     * punch added to one of those calls and forgotten at another is exactly the
     * kind of gap a demo world hides until somebody demonstrates it.
     */
    const seeded = await tx.attendanceRecord.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, staffId: true, clockInAt: true, clockOutAt: true, source: true },
    });
    for (const record of seeded) {
      if (record.id === lunchDay.id) continue;
      for (const [instant, kind] of [
        [record.clockInAt, 'IN'],
        [record.clockOutAt, 'OUT'],
      ] as [Date | null, 'IN' | 'OUT'][]) {
        if (!instant) continue;
        await tx.attendancePunch.create({
          data: {
            tenantId: tenant.id,
            attendanceRecordId: record.id,
            staffId: record.staffId,
            at: instant,
            kind,
            source: record.source,
          },
        });
      }
    }

    // --- Leave -------------------------------------------------------------
    await tx.leaveRequest.create({
      data: {
        tenantId: tenant.id, staffId: staff.counter2, leaveType: 'ANNUAL',
        startDate: day(-9), endDate: day(-7), reason: 'Family event', status: 'APPROVED',
        approvedByStaffId: staff.owner, approvedAt: at(-12, 3),
      },
    });
    await tx.leaveRequest.create({
      data: {
        tenantId: tenant.id, staffId: staff.stock, leaveType: 'MEDICAL',
        startDate: day(-4), endDate: day(-3), reason: 'MC issued by an outside clinic', status: 'APPROVED',
        approvedByStaffId: staff.owner, approvedAt: at(-4, 2),
      },
    });
    await tx.leaveRequest.create({
      data: {
        tenantId: tenant.id, staffId: staff.counter, leaveType: 'ANNUAL',
        startDate: day(14), endDate: day(18), reason: 'Holiday', status: 'PENDING',
      },
    });
    // SOMEBODY ON LEAVE TODAY. Every leave above is in the past or the future,
    // so HR ▸ Today showed "Nobody is on leave" — which reads as a screen that
    // does not work rather than a quiet day.
    //
    // The panel clerk, and specifically NOT the stock controller: he is clocked
    // in today a few lines below, and the first attempt put him in "On duty"
    // and "Away today" at the same time. A fixture that contradicts itself is
    // worse than an empty one, because the reviewer cannot tell whether the
    // screen or the data is wrong.
    await tx.leaveRequest.create({
      data: {
        tenantId: tenant.id, staffId: staff.panel, leaveType: 'ANNUAL',
        startDate: day(0), endDate: day(1), reason: 'Family matters', status: 'APPROVED',
        approvedByStaffId: staff.owner, approvedAt: at(-3, 2),
      },
    });
    await tx.leaveRequest.create({
      data: {
        tenantId: tenant.id, staffId: staff.finance, leaveType: 'UNPAID',
        startDate: day(-6), endDate: day(-6), reason: 'Personal', status: 'APPROVED',
        approvedByStaffId: staff.owner, approvedAt: at(-8, 2),
      },
    });

    // --- Staff medical benefit ---------------------------------------------
    //
    // THREE ACCOUNTS IN THREE STATES, because one account with one use cannot
    // show whether the screen distinguishes healthy from nearly-spent from
    // overdrawn — and those are the three answers a clinic acts on. One
    // dependant draws on the same pot as the member, which is the rule the
    // balance exists to enforce.
    const benefitYear = new Date().getUTCFullYear();
    const benefitAccounts: { key: 'counter' | 'stock' | 'finance'; who: string; allowance: number; uses: { offset: number; amount: number; note: string; forWhom?: string }[] }[] = [
      {
        key: 'counter',
        who: 'Nurul Hidayah',
        allowance: 1500,
        uses: [{ offset: -30, amount: 180, note: 'Consultation and medication' }],
      },
      {
        key: 'stock',
        who: 'Hafiz Osman',
        allowance: 1200,
        uses: [
          { offset: -180, amount: 420, note: 'Dental treatment' },
          { offset: -95, amount: 360, note: 'Physiotherapy course' },
          { offset: -21, amount: 260, note: 'Specialist referral', forWhom: 'Zara Osman' },
        ],
      },
      {
        key: 'finance',
        who: 'Chandra Devi',
        allowance: 900,
        uses: [
          { offset: -210, amount: 500, note: 'Minor day surgery' },
          { offset: -60, amount: 470, note: 'Follow-up and imaging' },
        ],
      },
    ];
    for (const entry of benefitAccounts) {
      const account = await tx.staffBenefitAccount.create({
        data: { tenantId: tenant.id, staffId: staff[entry.key], benefitYear, allowance: entry.allowance },
      });
      await tx.staffBenefitMember.create({
        data: { tenantId: tenant.id, accountId: account.id, name: entry.who, relationship: 'SELF' },
      });
      if (entry.key === 'stock') {
        await tx.staffBenefitMember.create({
          data: { tenantId: tenant.id, accountId: account.id, name: 'Zara Osman', relationship: 'CHILD' },
        });
      }
      for (const use of entry.uses) {
        await tx.staffBenefitUsage.create({
          data: {
            tenantId: tenant.id,
            accountId: account.id,
            usedAt: day(use.offset),
            amount: use.amount,
            notes: use.note,
            recordedByStaffId: staff.finance,
          },
        });
      }
    }

    // --- Doctor incentives -------------------------------------------------
    const commission = await tx.incentiveRule.create({
      data: {
        tenantId: tenant.id, name: 'Resident sales commission', ruleType: 'SALES_COMMISSION',
        employmentType: 'PERMANENT', thresholdAmount: 300, flatAmount: 200, percentAbove: '5.000',
        version: 1, effectiveFrom: day(-365), createdByStaffId: staff.owner,
        notes: 'RM200 on reaching RM300 of monthly billing, plus 5% of everything above it',
      },
    });
    await tx.incentiveRule.create({
      data: {
        tenantId: tenant.id, name: 'Minor procedure incentive', ruleType: 'PROCEDURE',
        serviceCatalogIds: [services[2].id, services[1].id], perProcedureAmount: 25,
        version: 1, effectiveFrom: day(-365), createdByStaffId: staff.owner,
        notes: 'RM25 for each suturing or dressing procedure completed',
      },
    });

    const incentiveRun = await tx.incentiveRun.create({
      data: {
        tenantId: tenant.id, clinicId: central.id, period: monthStart(), status: 'APPROVED',
        createdByStaffId: staff.owner, approvedByStaffId: staff.owner, approvedAt: at(-1, 8),
        calculatedAt: at(-1, 7), totalAmount: 260,
      },
    });
    await tx.incentiveResult.create({
      data: {
        tenantId: tenant.id, incentiveRunId: incentiveRun.id, staffId: staff.resident,
        incentiveRuleId: commission.id, ruleVersion: 1,
        ruleSnapshot: { name: 'Resident sales commission', thresholdAmount: '300', flatAmount: '200', percentAbove: '5.000', version: 1 } as never,
        basisAmount: 1500, basisCount: 6, amount: 260,
        calculation: { sales: 1500, threshold: 300, qualified: true, flat: 200, aboveThreshold: 1200, percentPart: 60, explanation: 'Threshold reached. Flat amount, plus 5% of the amount above the threshold.' } as never,
      },
    });

    // --- Statutory rate set ------------------------------------------------
    //
    // The Malaysian EPF/SOCSO/EIS schedules, seeded as CORROBORATED and NOT
    // VERIFIED. That is the honest state: the tables were transcribed from the
    // clinic's own workbook and cross-checked against published references, but
    // kwsp.gov.my and perkeso.gov.my are unreachable from the build
    // environment, so nobody has compared them to the authority's own copy.
    // A run calculated against them is PROVISIONAL and says so.
    const statutoryTables = JSON.parse(
      readFileSync(join(__dirname, 'statutory-my-2024-10.json'), 'utf8'),
    ) as Record<string, unknown>;
    const ruleSet = await tx.statutoryRuleSet.create({
      data: {
        tenantId: tenant.id,
        name: statutoryTables.name as string,
        jurisdiction: 'MY',
        effectiveFrom: new Date('2024-10-01T00:00:00.000Z'),
        verificationStatus: 'CORROBORATED',
        sourceUrl: 'https://www.kwsp.gov.my/en/epf-act-1991-third-schedule',
        verificationNote: statutoryTables.sourceNote as string,
        epfRules: statutoryTables.epfRules as never,
        socsoRules: statutoryTables.socsoRules as never,
        eisRules: statutoryTables.eisRules as never,
        pcbRules: undefined,
        createdByStaffId: staff.owner,
      },
    });

    // --- Payroll inputs ----------------------------------------------------
    //
    // PCB is not calculated by this system, so it is ENTERED — which is what
    // the clinic already does in its spreadsheet. Two people deliberately have
    // no PCB entered, so the blocking exception the owner needs to see is on
    // screen rather than described in a document.
    const payrollPeriod = monthStart(-1);
    const pcbEntered: Record<string, number> = { owner: 1855.4, resident: 542.15, finance: 62.3 };
    for (const [key, amount] of Object.entries(pcbEntered)) {
      await tx.payrollInputEntry.create({
        data: {
          tenantId: tenant.id, clinicId: central.id, staffId: staff[key], period: payrollPeriod,
          componentCode: 'PCB', label: 'PCB (computed outside Kuwick)', amount,
          note: 'Keyed from the LHDN calculator, as the clinic does today.',
          createdByStaffId: staff.finance,
        },
      });
    }
    await tx.payrollInputEntry.create({
      data: {
        tenantId: tenant.id, clinicId: central.id, staffId: staff.counter, period: payrollPeriod,
        componentCode: 'ALLOWANCE', label: 'Fixed monthly allowance', amount: 250,
        createdByStaffId: staff.finance,
      },
    });
    // Paid this month, EARNED last month — the clinic pays variable pay one
    // month in arrears and a payslip that cannot say so is misleading.
    await tx.payrollInputEntry.create({
      data: {
        tenantId: tenant.id, clinicId: central.id, staffId: staff.counter2, period: payrollPeriod,
        componentCode: 'MILEAGE', label: 'Outreach mileage', amount: 86.4,
        earnedPeriod: monthStart(-2), createdByStaffId: staff.finance,
      },
    });

    /*
     * THE ITEMISED DETAIL BEHIND THE NEW COLUMNS.
     *
     * The payslip lines above are what the ENGINE priced; these are the input
     * rows the drawer lists under Earnings, each carrying where it came from.
     * A figure with no input row shows in the register but has nothing to say
     * for itself when somebody opens the person — which is the question the
     * drawer exists to answer.
     */
    for (const entry of [
      { key: 'manager', code: 'ALLOWANCE', label: 'Responsibility allowance', amount: 400, clinic: central.id },
      { key: 'nurse', code: 'INCENTIVE', label: 'Procedure incentive', amount: 180, clinic: central.id },
      { key: 'pharm', code: 'CLAIM_REIMBURSEMENT', label: 'Course fee reimbursement', amount: 145.6, clinic: branch.id },
      { key: 'accounts', code: 'COMMISSION', label: 'Panel collections commission', amount: 420, clinic: branch.id },
      { key: 'accounts', code: 'BONUS', label: 'Half-year bonus', amount: 500, clinic: branch.id },
    ]) {
      await tx.payrollInputEntry.create({
        data: {
          tenantId: tenant.id, clinicId: entry.clinic, staffId: staff[entry.key], period: payrollPeriod,
          componentCode: entry.code, label: entry.label, amount: entry.amount,
          createdByStaffId: staff.finance,
        },
      });
    }

    // --- Payroll run, CALCULATED THROUGH THE REAL ENGINE -------------------
    //
    // Not hand-written figures. The seed calls the same code the service does,
    // so the numbers on the review screens are the numbers the product
    // produces — including the two blocking PCB exceptions.
    const payroll = await tx.payrollRun.create({
      data: {
        // The employing company, exactly as create() derives it for a
        // single-entity branch: every Central employee is Klinik Contoh's.
        // Seeding it null made a legacy-shaped run the product no longer
        // creates — and priced the HRD levy "not recorded" for a company
        // whose s.14 registration this very seed records.
        tenantId: tenant.id, clinicId: central.id, legalEmployerId: employer.id,
        period: payrollPeriod, status: 'CALCULATED',
        // What the engine itself would write for this period: every schedule
        // in the registry meets the approval bar, so the world's banner state
        // is CONFIGURED. The seed used to hand-write PROVISIONAL with a
        // CORROBORATED legacy blob — a state the product no longer produces,
        // which put a false "not production-ready" banner on every screen
        // until the first recalculate quietly disagreed with it.
        statutoryStatus: 'CONFIGURED', statutoryRuleSetId: ruleSet.id,
        statutorySnapshot: {
          name: ruleSet.name, effectiveFrom: ruleSet.effectiveFrom,
          verificationStatus: 'OFFICIAL_SOURCE_VERIFIED', verified: true,
        } as never,
        createdByStaffId: staff.finance, calculatedAt: at(-2, 8),
      },
    });

    const orp = { overtimeDaysPerMonth: 26, unpaidLeaveDaysPerMonth: 31, hoursPerDay: 7.5 };
    const staffRows = await tx.staff.findMany({ where: { id: { in: Object.values(staff) } }, select: { id: true, fullName: true } });
    const byId = new Map(staffRows.map((row) => [row.id, row.fullName]));
    const staffNames: Record<string, string> = Object.fromEntries(
      Object.entries(staff).map(([key, id]) => [key, byId.get(id) ?? key]),
    );
    const periodEndDay = new Date(Date.UTC(payrollPeriod.getUTCFullYear(), payrollPeriod.getUTCMonth() + 1, 0));
    // THE CODE TRAVELS WITH THE EXCEPTION.
    //
    // The run carries exceptions twice over: the legacy JSON blob the banner
    // reads, and the `payroll_exceptions` rows the APPROVAL GATE reads. The
    // service writes both; this seed wrote only the blob, so it produced a run
    // in a shape the engine never produces — five people who cannot be paid,
    // and an Approve button that was happy to lock it. Keeping the catalogue
    // code here is what lets the rows below be built from the same catalogue
    // the service uses, rather than from a second copy of the wording.
    const exceptions: { staffId: string; name: string; issue: string; code: string }[] = [];
    let gross = 0, deductions = 0, net = 0, employerCost = 0, counted = 0;

    for (const [index, profile] of profiles.entries()) {
      const staffId = staff[profile.key];
      const name = staffNames[profile.key] ?? profile.key;
      if (profile.salary === null) {
        // THE ENGINE'S OWN TEST, not a looser one. `calculate()` raises this
        // only when there is neither a monthly salary NOR an hourly rate, so a
        // fixture that raised it for an hourly locum described a run the
        // product would never produce — and the first Recalculate on the
        // screen would silently disagree with the seeded banner.
        //
        // The locum has a rate and is simply not priced by this seed: a
        // session-based person is paid from sessions worked, which this
        // fixture does not invent. The engine prices him on recalculation.
        if (profile.type !== 'LOCUM') {
          exceptions.push({ staffId, name, code: 'NO_SALARY', issue: 'No salary or hourly rate on record — this employee cannot be paid until one is set.' });
        }
        continue;
      }
      const age = ageAt(new Date(Date.UTC(profile.born[0], profile.born[1], profile.born[2])), periodEndDay)!;
      const basicCents = Math.round(profile.salary * 100);
      // s.18A — the unpaid-leave divisor is the length of THIS wage period, so
      // `ordinaryRates` takes it as a third argument. This call was left at two
      // when that changed, and nothing caught it because prisma/ was outside
      // the typecheck. `npm run typecheck:seed` now covers this file.
      const rates = ordinaryRates(basicCents, orp, periodEndDay.getUTCDate());

      const lines: PayrollComponentLine[] = [
        { code: 'BASIC', label: 'Basic pay', kind: 'EARNING', amount: profile.salary, liability: DEFAULT_COMPONENT_LIABILITY.BASIC },
      ];
      if (profile.key === 'counter') {
        const ot = computeOvertime([{ label: 'Normal day (1.5x)', hours: 4, multiplier: 1.5 }], rates.overtimeHourlyCents);
        lines.push({ code: 'OVERTIME', label: 'Overtime', kind: 'EARNING', amount: ot.totalCents / 100, liability: DEFAULT_COMPONENT_LIABILITY.OVERTIME });
        lines.push({ code: 'ALLOWANCE', label: 'Fixed monthly allowance', kind: 'EARNING', amount: 250, liability: DEFAULT_COMPONENT_LIABILITY.ALLOWANCE });
      }
      if (profile.key === 'counter2') {
        lines.push({ code: 'MILEAGE', label: 'Outreach mileage', kind: 'EARNING', amount: 86.4, liability: DEFAULT_COMPONENT_LIABILITY.MILEAGE });
      }
      if (profile.key === 'resident') {
        lines.push({ code: 'INCENTIVE', label: 'Procedure incentive', kind: 'EARNING', amount: 260, liability: DEFAULT_COMPONENT_LIABILITY.INCENTIVE });
      }
      if (profile.key === 'finance') {
        // WAGE_REDUCTION, exactly as the catalogue classifies it: seeding it
        // as a DEDUCTION left gross un-reduced AND counted the day among the
        // withholdings, so every seeded line failed the client's own
        // arithmetic check with "Does not add up" before anybody touched it.
        lines.push({ code: 'UNPAID_LEAVE', label: 'Unpaid leave (1 day)', kind: 'WAGE_REDUCTION', amount: rates.unpaidLeaveDailyCents / 100, liability: DEFAULT_COMPONENT_LIABILITY.UNPAID_LEAVE });
      }
      /*
       * THE EARNINGS THE REGISTER HAD NO DATA TO SHOW.
       *
       * Every column past Basic was empty for almost everybody, so a screen
       * built to answer "how did this person get this net salary?" was being
       * judged on a month where the answer was always "their salary". These
       * four give the register a commission, a bonus, a reimbursed claim, a
       * second incentive and a two-day wage reduction to draw.
       */
      if (profile.key === 'manager') {
        lines.push({ code: 'UNPAID_LEAVE', label: 'Unpaid leave (2 days)', kind: 'WAGE_REDUCTION', amount: (rates.unpaidLeaveDailyCents * 2) / 100, liability: DEFAULT_COMPONENT_LIABILITY.UNPAID_LEAVE });
        lines.push({ code: 'ALLOWANCE', label: 'Responsibility allowance', kind: 'EARNING', amount: 400, liability: DEFAULT_COMPONENT_LIABILITY.ALLOWANCE });
      }
      if (profile.key === 'nurse') {
        lines.push({ code: 'INCENTIVE', label: 'Procedure incentive', kind: 'EARNING', amount: 180, liability: DEFAULT_COMPONENT_LIABILITY.INCENTIVE });
        const ot = computeOvertime([{ label: 'Rest day (2.0x)', hours: 3, multiplier: 2 }], rates.overtimeHourlyCents);
        lines.push({ code: 'OVERTIME', label: 'Overtime', kind: 'EARNING', amount: ot.totalCents / 100, liability: DEFAULT_COMPONENT_LIABILITY.OVERTIME });
      }
      if (profile.key === 'pharm') {
        // A claim the clinic chose to reimburse WITH salary. It reaches gross
        // once and only once — the materialiser's one-to-one constraint is
        // what stops a claim being paid twice, and this is the row that
        // demonstrates it on screen.
        lines.push({ code: 'CLAIM_REIMBURSEMENT', label: 'Course fee reimbursement', kind: 'EARNING', amount: 145.6, liability: DEFAULT_COMPONENT_LIABILITY.CLAIM_REIMBURSEMENT });
      }
      if (profile.key === 'accounts') {
        lines.push({ code: 'COMMISSION', label: 'Panel collections commission', kind: 'EARNING', amount: 420, liability: DEFAULT_COMPONENT_LIABILITY.COMMISSION });
        lines.push({ code: 'BONUS', label: 'Half-year bonus', kind: 'EARNING', amount: 500, liability: DEFAULT_COMPONENT_LIABILITY.BONUS });
      }

      /**
       * What the payslip lines say a component came to. See the note on the
       * payroll line's columns below: this is what stops a column and its own
       * component disagreeing.
       */
      const sumOf = (...codes: string[]) =>
        Number(
          lines
            .filter((l) => codes.includes(l.code))
            .reduce((total, l) => total + Number(l.amount), 0)
            .toFixed(2),
        );

      /*
       * THE SEED COMPUTES A PAYSLIP THE SAME WAY THE RUN DOES.
       *
       * It used to hand `statutoryTables` — a StatutoryRuleSet row — where a
       * StatutoryContext belongs, cast through `as never`, and crashed on the
       * first employee once the engine started resolving schedules by period.
       * Nothing caught it because prisma/ was outside the typecheck and nobody
       * had run the seed since.
       *
       * The classification values below are the SAME ones written to
       * `employee_statutory_classifications` above; a payslip computed on a
       * different standing from the record behind it would be a demo clinic
       * that contradicts itself.
       */
      const slip = computePayslip(
        lines,
        // The last day INSIDE the period — the engine's own convention.
        { periodEnd: periodEndDay },
        {
          age,
          epfEmployeeRate: 11,
          epfMembership: 'MALAYSIAN_CITIZEN',
          epfApplicable: profile.type !== 'LOCUM',
          socsoApplicable: profile.type !== 'LOCUM',
          eisApplicable: profile.type !== 'LOCUM',
          lindungParticipation:
            profile.key === 'locum'
              ? 'MANDATORY_FOREIGN_WORKER'
              : profile.key === 'counter2'
                ? 'NOT_PARTICIPATING'
                : 'ENROLLED',
          // The employing company's registration — the same s.14 fact the
          // legalEmployerStatutoryProfile row above records, threaded exactly
          // as the run's own calculation threads it. Omitting it priced the
          // levy "not recorded" on lines seeded by the very file that
          // records the registration.
          hrdRegistration: 'MANDATORY_SECTION_14',
          hrdFullTimeEmployment: profile.type === 'PERMANENT' || profile.type === 'CONTRACT',
          pcbApplicable: true,
          // The same three unrecorded profiles as the classification rows
          // above, so the engine's own null is what raises the blocker.
          ...(['counter', 'counter2', 'stock'].includes(profile.key)
            ? { taxResidence: null, pcbCategory: null, qualifyingChildren: 0 }
            : {
                taxResidence: 'RESIDENT' as const,
                pcbCategory: (profile.key === 'owner' ? 2 : 1) as 1 | 2 | 3,
                qualifyingChildren: profile.key === 'owner' ? 2 : 0,
              }),
        },
        undefined,
        null,
        // The resident's recorded EPF basis — the same selection the
        // employee_contribution_bases row above records, threaded exactly as
        // the run's own calculation threads it.
        profile.key === 'resident'
          ? { mode: 'BASIC_PLUS_SELECTED', includedComponentCodes: ['INCENTIVE'] }
          : null,
      );

      /*
       * PCB IS MISSING WHEN IT COULD NOT BE WORKED OUT — not when nobody
       * typed it.
       *
       * This asked only "is there a hand-keyed figure for this person?", and
       * so raised a BLOCKING exception for every employee the MTD engine had
       * priced perfectly well. Seven of ten people in this clinic carried a
       * red "Blocked" chip on the register for a monthly tax of RM0.00 —
       * which is the correct answer at those salaries, not a missing one.
       *
       * The seeded world therefore contradicted the product: `payroll.service`
       * raises PCB_MISSING only on `pcbCents === null`, so the first
       * Recalculate on screen would have cleared seven blockers and told a
       * different story from the one the fixture set up. It mirrors the
       * service now — a hand-keyed figure completes a slip the engine could
       * not price, and an engine that priced it needs no help.
       */
      const pcb = pcbEntered[profile.key];
      if (slip.statutory.pcbCents === null) {
        if (pcb === undefined) {
          exceptions.push({
            staffId, name, code: 'PCB_MISSING',
            issue: 'Monthly tax (PCB) is missing. Record the tax profile and Kuwick calculates it, or enter the figure as a payroll input.',
          });
        } else {
          slip.statutory.pcbCents = Math.round(pcb * 100);
          slip.employeeDeductionCents += slip.statutory.pcbCents;
          slip.netCents -= slip.statutory.pcbCents;
          slip.incomplete = false;
        }
      }

      await tx.payrollLine.create({
        data: {
          tenantId: tenant.id, payrollRunId: payroll.id, staffId,
          // The same shape a real run writes, so the UAT payslip and workspace
          // can show which statutory standing produced these figures rather
          // than falling back to today's employee record.
          employeeSnapshot: {
            name,
            position: profile.position,
            employmentType: profile.type,
            bankName: 'Bank Contoh',
            statutoryClassification: {
              effectiveFrom: day(-500 - index * 30).toISOString().slice(0, 10),
              epfApplicable: profile.type !== 'LOCUM',
              epfMembership: 'MALAYSIAN_CITIZEN',
              epfEmployeeRate: 11,
              socsoApplicable: profile.type !== 'LOCUM',
              eisApplicable: profile.type !== 'LOCUM',
              lindungParticipation:
                profile.key === 'locum'
                  ? 'MANDATORY_FOREIGN_WORKER'
                  : profile.key === 'counter2'
                    ? 'NOT_PARTICIPATING'
                    : 'ENROLLED',
              pcbApplicable: true,
              // Mirrors the classification rows: the three the UAT journey
              // fixes have no tax profile recorded.
              ...(['counter', 'counter2', 'stock'].includes(profile.key)
                ? { taxResidence: null, pcbCategory: null, qualifyingChildren: 0 }
                : {
                    taxResidence: 'RESIDENT',
                    pcbCategory: profile.key === 'owner' ? 'CATEGORY_2' : 'CATEGORY_1',
                    qualifyingChildren: profile.key === 'owner' ? 2 : 0,
                  }),
              disabledSelf: false,
              disabledSpouse: false,
              restDayOfWeek: 0,
              overtimeContractPolicy: null,
            },
          } as never,
          basicSalary: profile.salary,
          /*
           * THE COLUMNS COME FROM THE LINES, not from a list of names.
           *
           * These were ternaries keyed by person — `profile.key === 'counter'
           * ? 250 : ...` — restating figures that were already in `lines` two
           * screens up. Adding an employee therefore put their allowance,
           * incentive and bonus in NO column: the money still reached gross,
           * so nothing failed, and it surfaced on the register as an
           * unexplained residual in "Claims & other". Three of four new people
           * were wrong that way before this was found.
           *
           * `lines` is the input the engine priced. Deriving from it means a
           * component cannot be in the payslip and missing from its column.
           */
          allowances: sumOf('ALLOWANCE', 'ATTENDANCE_ALLOWANCE', 'MILEAGE'),
          overtimePay: sumOf('OVERTIME'),
          incentives: sumOf('INCENTIVE', 'COMMISSION'),
          bonus: sumOf('BONUS'),
          grossPay: slip.grossCents / 100,
          unpaidLeaveDeduction: sumOf('UNPAID_LEAVE'),
          epfEmployee: slip.statutory.epf.employeeCents === null ? null : slip.statutory.epf.employeeCents / 100,
          epfEmployer: slip.statutory.epf.employerCents === null ? null : slip.statutory.epf.employerCents / 100,
          socsoEmployee: slip.statutory.socso.employeeCents === null ? null : slip.statutory.socso.employeeCents / 100,
          socsoEmployer: slip.statutory.socso.employerCents === null ? null : slip.statutory.socso.employerCents / 100,
          eisEmployee: slip.statutory.eis.employeeCents === null ? null : slip.statutory.eis.employeeCents / 100,
          eisEmployer: slip.statutory.eis.employerCents === null ? null : slip.statutory.eis.employerCents / 100,
          pcb: slip.statutory.pcbCents === null ? null : slip.statutory.pcbCents / 100,
          // Both computed by the slip above and previously DROPPED on write:
          // net already included LINDUNG and employer cost the levy, so the
          // row disagreed with its own columns until the first recalculate.
          lindungEmployee: slip.statutory.lindung.employeeCents === null ? null : slip.statutory.lindung.employeeCents / 100,
          hrdLevy: slip.hrdLevyCents === null ? null : slip.hrdLevyCents / 100,
          netPay: slip.netCents / 100,
          employerCost: slip.employerCostCents / 100,
          workedDays: 20,
          // Derived the same way, from the same lines.
          unpaidDays: rates.unpaidLeaveDailyCents > 0
            ? Math.round((sumOf('UNPAID_LEAVE') * 100) / rates.unpaidLeaveDailyCents)
            : 0,
          overtimeHours: rates.overtimeHourlyCents > 0
            ? Number(((sumOf('OVERTIME') * 100) / rates.overtimeHourlyCents).toFixed(2))
            : 0,
          breakdown: {
            age,
            bases: { epf: slip.bases.epfCents / 100, socso: slip.bases.socsoCents / 100, eis: slip.bases.eisCents / 100 },
            components: lines.map((l) => ({ code: l.code, label: l.label, kind: l.kind, amount: l.amount, liability: l.liability })),
            ordinaryRateOfPay: { overtimeDays: 26, unpaidLeaveDays: 31, hoursPerDay: 7.5, overtimeHourly: rates.overtimeHourlyCents / 100, unpaidLeaveDaily: rates.unpaidLeaveDailyCents / 100 },
            statutoryNotes: { epf: slip.statutory.epf.note ?? null, socso: slip.statutory.socso.note ?? null, eis: slip.statutory.eis.note ?? null, pcb: slip.statutory.pcbNote, lindung: slip.statutory.lindung.note ?? null, hrd: slip.hrdNote ?? null },
            // The applied EPF basis, as the service writes it — so the seeded
            // world's one recorded selection survives into the line the same
            // way a real calculation would freeze it.
            ...(slip.epfBasis
              ? {
                  epfBasis: {
                    mode: slip.epfBasis.mode,
                    includedCodes: slip.epfBasis.includedCodes,
                    assessedEpfCents: slip.epfBasis.assessedEpfCents,
                    appliedEpfCents: slip.epfBasis.appliedEpfCents,
                    excluded: slip.epfBasis.excluded,
                    ineffective: slip.epfBasis.ineffective,
                    basisRowId: null,
                  },
                }
              : {}),
            incomplete: slip.incomplete,
          } as never,
        },
      });

      gross += slip.grossCents;
      deductions += slip.employeeDeductionCents;
      net += slip.netCents;
      employerCost += slip.employerCostCents;
      counted += 1;
    }

    await tx.payrollRun.update({
      where: { id: payroll.id },
      data: {
        grossTotal: gross / 100, deductionTotal: deductions / 100, netTotal: net / 100,
        employerCostTotal: employerCost / 100, employeeCount: counted,
        exceptions: exceptions as never,
      },
    });

    // THE ROWS THE APPROVAL GATE ACTUALLY READS.
    //
    // Built from the shared catalogue, not from a second copy of the wording,
    // so the fixture cannot drift from the service: a severity or a remedy
    // changed in `payroll-exception.ts` changes here too. Without them the
    // gate counts zero blocking exceptions and a run with five unpayable
    // people can be approved and locked — which is what a payroll fixture is
    // supposed to catch, not demonstrate.
    // WARNINGS AS WELL AS BLOCKERS, because the severity distinction is the
    // whole reason the exception centre exists and a fixture carrying only
    // blockers cannot show it. Both are true of the attendance seeded above:
    // three unapproved overtime hours on the 12th, a missing clock-out on the
    // 18th. One is left standing; the other has been passed deliberately, with
    // a reason, so the "passed" state is reviewable too.
    const warnings: { code: string; staffId: string; ctx: Record<string, string | number>; passed?: string }[] = [
      { code: 'UNAPPROVED_OVERTIME', staffId: staff.counter, ctx: { hours: 3 } },
      {
        code: 'MISSING_PUNCH', staffId: staff.counter2, ctx: { days: 1 },
        passed: 'Door log confirms an 18:00 departure; the reader was offline that evening.',
      },
    ];

    for (const raw of exceptions) {
      const built = buildException(raw.code, raw.staffId, { staffId: raw.staffId, runId: payroll.id });
      await tx.payrollException.create({
        data: {
          tenantId: tenant.id,
          payrollRunId: payroll.id,
          staffId: built.staffId,
          severity: built.severity as ExceptionSeverity,
          code: built.code,
          cause: built.cause,
          consequence: built.consequence,
          remediation: built.remediation,
          deepLink: built.deepLink,
          overridable: built.overridable,
        },
      });
    }

    for (const warning of warnings) {
      const built = buildException(warning.code, warning.staffId, {
        ...warning.ctx,
        staffId: warning.staffId,
        runId: payroll.id,
      });
      await tx.payrollException.create({
        data: {
          tenantId: tenant.id,
          payrollRunId: payroll.id,
          staffId: built.staffId,
          severity: built.severity as ExceptionSeverity,
          code: built.code,
          cause: built.cause,
          consequence: built.consequence,
          remediation: built.remediation,
          deepLink: built.deepLink,
          overridable: built.overridable,
          ...(warning.passed
            ? {
                overriddenByStaffId: staff.owner,
                overrideReason: warning.passed,
                overriddenAt: at(-2, 9),
              }
            : {}),
        },
      });
    }

    console.log(`  workforce: ${profiles.filter((p) => !p.contractor).length} employees + ${profiles.filter((p) => p.contractor).length} contractor, 20 days attendance, leave, incentive run, payroll CALCULATED against corroborated MY statutory tables (${exceptions.length} exceptions)`);

  });
}

// ---------------------------------------------------------------------------
// ANALYTICS: segments, programmes and marketing templates.
// ---------------------------------------------------------------------------
async function seedAnalytics(ids: Ids) {
  await withTenant(async (tx) => {
    const { tenant, staff, services, items } = ids;

    const segments = [
      { name: 'Maternal & Obstetric', code: 'MATERNAL', sortOrder: 10, colour: '#8b5cf6', rules: [{ serviceCatalogId: services[3].id, priority: 10 }, { descriptionMatch: 'antenatal', priority: 15 }] },
      { name: 'NCD', code: 'NCD', sortOrder: 20, colour: '#0f766e', rules: [{ serviceCatalogId: services[4].id, priority: 20 }, { itemCategory: 'Antidiabetic', priority: 25 }, { itemCategory: 'Antihypertensive', priority: 26 }] },
      { name: 'Minor OT', code: 'MINOR_OT', sortOrder: 30, colour: '#b45309', rules: [{ serviceCatalogId: services[2].id, priority: 30 }, { serviceCatalogId: services[1].id, priority: 31 }] },
      { name: 'Weight Loss', code: 'WEIGHT', sortOrder: 40, colour: '#be123c', rules: [{ serviceCatalogId: services[5].id, priority: 40 }, { itemId: items.SEMA025.id, priority: 41 }] },
      { name: 'Outpatient', code: 'OUTPATIENT', sortOrder: 50, colour: '#184a6b', rules: [{ serviceCatalogId: services[0].id, priority: 900 }, { descriptionMatch: 'consultation', priority: 950 }] },
    ];
    for (const segment of segments) {
      await tx.businessSegment.create({
        data: {
          tenantId: tenant.id, name: segment.name, code: segment.code, colour: segment.colour, sortOrder: segment.sortOrder,
          rules: { create: segment.rules.map((rule) => ({ tenantId: tenant.id, ...rule })) },
        },
      });
    }

    const ncd = await tx.clinicProgramme.create({
      data: {
        tenantId: tenant.id, name: 'NCD Care', code: 'NCD',
        description: 'Diabetes and hypertension follow-up',
        serviceCatalogIds: [services[4].id],
        itemIds: [items.MET500.id, items.AML5.id],
        diagnosisCodes: ['E11', 'I10'],
      },
    });
    const weight = await tx.clinicProgramme.create({
      data: {
        tenantId: tenant.id, name: 'Weight Management', code: 'WEIGHT',
        description: 'GLP-1 assisted weight management',
        serviceCatalogIds: [services[5].id],
        itemIds: [items.SEMA025.id],
      },
    });

    const patients = await tx.patient.findMany({ where: { tenantId: tenant.id }, orderBy: { name: 'asc' }, take: 6 });
    for (const [index, patient] of patients.entries()) {
      await tx.programmeEnrolment.create({
        data: {
          tenantId: tenant.id,
          programmeId: index % 2 === 0 ? ncd.id : weight.id,
          patientId: patient.id,
          enrolledAt: day(-120 + index * 10),
          enrolledByStaffId: staff.owner,
        },
      });
    }

    await tx.marketingTemplate.create({
      data: {
        tenantId: tenant.id, name: 'NCD follow-up reminder', category: 'Recall',
        body: 'Hi {{firstName}}, this is {{clinic}}. Your next NCD review is due. Reply to this message to book a time.',
        placeholders: ['firstName', 'clinic'],
        createdByStaffId: staff.owner,
      },
    });
    await tx.marketingTemplate.create({
      data: {
        tenantId: tenant.id, name: 'Lapsed patient check-in', category: 'Recall',
        body: 'Hello {{name}}, we have not seen you at {{clinic}} for a while. If you would like a check-up, just reply here.',
        placeholders: ['name', 'clinic'],
        createdByStaffId: staff.owner,
      },
    });

    console.log('  analytics: 5 segments, 2 programmes, 6 enrolments, 2 message templates');
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
