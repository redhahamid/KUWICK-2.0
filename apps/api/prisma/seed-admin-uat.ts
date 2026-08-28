import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';

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
 *   KUWICK_ADMIN_UAT_SEED=yes npx tsx prisma/seed-admin-uat.ts
 *
 * Idempotent by tenant: re-running deletes and rebuilds ITS OWN tenant and
 * touches nothing else.
 */

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const TENANT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const DOMAIN = 'admin-uat.kuwick.invalid';
const PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? 'AdminUat!2026';

type Tx = Prisma.TransactionClient;

function day(offset: number): Date {
  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(base + offset * 86400000);
}
function at(offset: number, hour: number, minute = 0): Date {
  return new Date(day(offset).getTime() + hour * 3600000 + minute * 60000);
}
function monthStart(offset = 0): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
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
      data: { id: TENANT_ID, name: 'Klinik Contoh Group (Synthetic UAT)' },
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
      { key: 'finance', name: 'Chandra Devi', role: 'FINANCE_STAFF' as const, clinic: null, doctor: false },
      { key: 'panel', name: 'Wan Azman', role: 'PANEL_STAFF' as const, clinic: central.id, doctor: false },
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
        { name: 'Contoh Pharma Supplies', contactName: 'Encik Rosli', phone: '03-1111 0001' },
        { name: 'Bandar Medical Trading', contactName: 'Ms Lee', phone: '03-1111 0002' },
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
          paymentTermDays: 30,
          claimFeeType: 'PERCENT' as const,
          claimFeeValue: 8,
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
          paymentTermDays: 45,
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
          paymentTermDays: 60,
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
  console.log(`  tenant   : Klinik Contoh Group (Synthetic UAT)`);
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

    // 2. CLAIMS: a claim's receivable is claimed + the panel's add-on fee.
    //    Once adjudicated, approved + rejected + written off must land on it —
    //    a panel cannot approve more than was asked for, or reject more.
    const claims = await tx.claimBatchLine.findMany({
      where: { tenantId: TENANT_ID },
      select: {
        panelClaimNo: true, claimedAmount: true, feeAmount: true, approvedAmount: true,
        rejectedAmount: true, writtenOffAmount: true, paidAmount: true, adjudicatedAt: true,
      },
    });
    for (const line of claims) {
      const receivable = Number(line.claimedAmount) + Number(line.feeAmount);
      const label = line.panelClaimNo ?? '(unsubmitted)';
      if (!line.adjudicatedAt) continue;
      const settled = Number(line.approvedAmount ?? 0) + Number(line.rejectedAmount ?? 0) + Number(line.writtenOffAmount ?? 0);
      if (Math.abs(settled - receivable) > 0.005) {
        problems.push(`claim ${label}: approved+rejected+written-off ${settled.toFixed(2)} != receivable ${receivable.toFixed(2)}`);
      }
      if (Number(line.paidAmount ?? 0) > Number(line.approvedAmount ?? 0) + 0.005) {
        problems.push(`claim ${label}: paid ${Number(line.paidAmount).toFixed(2)} exceeds approved ${Number(line.approvedAmount ?? 0).toFixed(2)}`);
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

    // 5. PAYROLL: a run that cannot compute statutory figures must SAY so.
    //    A payroll line carrying an EPF number under a NOT_CONFIGURED rule set
    //    is a fabricated statutory figure, which §5 forbids outright.
    const runs = await tx.payrollRun.findMany({
      where: { tenantId: TENANT_ID },
      select: { id: true, period: true, statutoryStatus: true, lines: { select: { epfEmployee: true, socsoEmployee: true, eisEmployee: true, pcb: true } } },
    });
    for (const run of runs) {
      if (run.statutoryStatus === 'CONFIGURED') continue;
      const fabricated = run.lines.filter(
        (l) => l.epfEmployee !== null || l.socsoEmployee !== null || l.eisEmployee !== null || l.pcb !== null,
      );
      if (fabricated.length > 0) {
        const label = run.period.toISOString().slice(0, 7);
        problems.push(`payroll ${label}: ${fabricated.length} line(s) carry statutory figures while the rule set is ${run.statutoryStatus}`);
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
  });

  if (problems.length > 0) {
    console.error('\nSeed wrote data that does not reconcile:');
    for (const problem of problems) console.error(`  - ${problem}`);
    throw new Error(`${problems.length} seed invariant(s) failed`);
  }
  console.log('  invariants: stock ledger, claim adjudication, remittances, invoice split, payroll, day end — all reconcile');
}

/** Deletes this tenant only, in dependency order. */
async function reset() {
  const exists = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM tenants WHERE id = $1`,
    TENANT_ID,
  );
  if (exists.length === 0) return;

  // Append-only tables refuse deletion by design, so the whole tenant is
  // dropped with the trigger disabled — legitimate here because this is a
  // seed rebuilding its OWN synthetic tenant on a disposable database, and
  // it is the only place in the repository that does it.
  const appendOnly = ['payments', 'stock_movements', 'claim_events', 'payroll_adjustments', 'visit_workflow_events', 'appointment_events', 'appointment_form_answers'];
  for (const table of appendOnly) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);
  }
  const order = [
    'marketing_dispatches', 'marketing_templates', 'marketing_audiences',
    'programme_enrolments', 'clinic_programmes', 'segment_mapping_rules', 'business_segments',
    'payroll_adjustments', 'payroll_lines', 'payroll_runs', 'statutory_rule_sets',
    'incentive_results', 'incentive_runs', 'incentive_rules',
    'staff_benefit_usages', 'staff_benefit_members', 'staff_benefit_accounts',
    'leave_balances', 'leave_policy_entitlements', 'leave_policies',
    'attendance_records', 'employee_profiles',
    'panel_remittance_allocations', 'panel_remittances', 'claim_events',
    'credit_note_lines', 'credit_notes', 'payments', 'day_end_closings',
    'claim_batch_lines', 'claim_batches',
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
    'panel_price_overrides', 'panel_exclusions', 'panel_clinics',
    'consultation_tariff_rules', 'service_catalog', 'item_age_dosages', 'items', 'item_categories',
    'suppliers', 'tax_rates', 'tax_codes', 'patient_alerts', 'patient_identity_changes', 'patients',
    'staff_role_assignments', 'staff_permission_grants', 'clinic_custom_roles',
    'staff_professional_audits', 'leave_requests', 'public_holidays', 'audit_logs',
    'chat_messages', 'chat_channels', 'rooms', 'queue_display_configs', 'staff_notifications',
    'notification_logs', 'media_assets', 'global_settings', 'visit_number_counters',
    'user_clinic_access', 'staff', 'users', 'clinics', 'tenants',
  ];
  for (const table of order) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE ${table === 'tenants' ? 'id' : 'tenant_id'} = $1`, TENANT_ID).catch(() => undefined);
  }
  for (const table of appendOnly) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);
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
  panels: { id: string; name: string; code: string | null }[];
  suppliers: { id: string; name: string }[];
  sst: { id: string };
  exempt: { id: string };
}>;

// ---------------------------------------------------------------------------
// STOCK: opening balances, a purchase order, a transfer with a discrepancy,
// near-expiry stock, a negative balance and a slow mover.
// ---------------------------------------------------------------------------
async function seedStock(ids: Ids) {
  await withTenant(async (tx) => {
    const { tenant, central, branch, staff, items, suppliers } = ids;

    async function move(clinicId: string, itemId: string, delta: number, type: string, extra: Record<string, unknown> = {}) {
      await tx.stockMovement.create({
        data: {
          tenantId: tenant.id,
          clinicId,
          itemId,
          quantityDelta: delta,
          movementType: type as never,
          createdByStaffId: staff.stock,
          ...extra,
        },
      });
      await tx.stockLevel.upsert({
        where: { tenantId_clinicId_itemId: { tenantId: tenant.id, clinicId, itemId } },
        create: { tenantId: tenant.id, clinicId, itemId, quantityOnHand: delta, minThreshold: 20 },
        update: { quantityOnHand: { increment: delta } },
      });
    }

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

    const openPo = await tx.purchaseOrder.create({
      data: { tenantId: tenant.id, clinicId: central.id, supplierId: suppliers[1].id, status: 'ORDERED', orderedAt: day(-6) },
    });
    await tx.purchaseOrderLine.create({
      data: { tenantId: tenant.id, purchaseOrderId: openPo.id, itemId: items.SEMA025.id, orderedQuantity: 20, unitCost: 315 },
    });

    // A pending procurement request from the branch.
    await tx.procurementRequest.create({
      data: { tenantId: tenant.id, clinicId: branch.id, itemId: items.MET500.id, requestedQuantity: 60, status: 'PENDING' },
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
        lines: { create: [{ tenantId: tenant.id, itemId: items.MET500.id, quantitySent: 30, quantityReceived: 30, unitCost: 3.2 }] },
      },
    });
    await move(central.id, items.MET500.id, -30, 'TRANSFER_OUT', { referenceType: 'StockTransfer', referenceId: clean.id });
    await move(branch.id, items.MET500.id, 30, 'TRANSFER_IN', { referenceType: 'StockTransfer', referenceId: clean.id });

    // TRANSFER 2 — a DISCREPANCY. Two strips never arrived and stay missing.
    const short = await tx.stockTransfer.create({
      data: {
        tenantId: tenant.id, transferNumber: nextNumber('TRF'), fromClinicId: central.id, toClinicId: branch.id,
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
        await tx.invoiceLine.create({
          data: {
            tenantId: tenant.id,
            invoiceId: invoice.id,
            description: line.description,
            quantity: 1,
            unitPrice: line.amount,
            amount: line.amount,
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
          methodLabel: tender === 'CASH' ? 'Cash' : tender === 'CARD' ? 'Credit Card' : tender === 'QR' ? 'DuitNow QR' : tender,
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
    const b1 = await makeVisit({ patientIndex: 3, clinicId: branch.id, doctorKey: 'locum', dayOffset: -2, lines: [{ description: 'General Consultation', amount: CONSULT }] });
    await pay(b1.invoice.id, branch.id, b1.patientShare, 'CASH', -2, 4);
    await tx.invoice.update({ where: { id: b1.invoice.id }, data: { status: 'PAID', paidAt: at(-2, 4), paymentMethod: 'Cash', patientPaidAmount: b1.patientShare } });

    const b2 = await makeVisit({ patientIndex: 4, clinicId: branch.id, doctorKey: 'locum', dayOffset: -2, lines: [{ description: 'Wound Dressing', amount: DRESSING }] });
    await pay(b2.invoice.id, branch.id, b2.patientShare, 'QR', -2, 6);
    await tx.invoice.update({ where: { id: b2.invoice.id }, data: { status: 'PAID', paidAt: at(-2, 6), paymentMethod: 'DuitNow QR', patientPaidAmount: b2.patientShare } });

    // --- A PARTIAL payment, still outstanding -----------------------------
    const partial = await makeVisit({ patientIndex: 5, clinicId: central.id, doctorKey: 'owner', dayOffset: -8, lines: [{ description: 'Weight Management Review', amount: WEIGHT }, { description: 'Semaglutide 0.25mg pen', amount: Number(items.SEMA025.sellPrice), taxable: false }] });
    await pay(partial.invoice.id, central.id, 200, 'CASH', -8, 5);
    await tx.invoice.update({ where: { id: partial.invoice.id }, data: { patientPaidAmount: 200 } });

    // --- A REFUND that reopened a balance ---------------------------------
    const refunded = await makeVisit({ patientIndex: 6, clinicId: central.id, doctorKey: 'resident', dayOffset: -14, lines: [{ description: 'Suturing (minor)', amount: SUTURE }] });
    await pay(refunded.invoice.id, central.id, refunded.patientShare, 'CARD', -14, 5);
    await pay(refunded.invoice.id, central.id, 60, 'CARD', -12, 9, 'REFUND', { notes: 'Procedure abandoned; portion returned' });
    await tx.invoice.update({ where: { id: refunded.invoice.id }, data: { patientPaidAmount: refunded.patientShare - 60 } });

    // --- A REVERSED payment (recorded in error) ---------------------------
    const reversedInvoice = await makeVisit({ patientIndex: 7, clinicId: central.id, doctorKey: 'owner', dayOffset: -20, lines: [{ description: 'General Consultation', amount: CONSULT }] });
    const wrong = await pay(reversedInvoice.invoice.id, central.id, reversedInvoice.patientShare, 'CASH', -20, 5);
    await tx.payment.create({
      data: {
        tenantId: tenant.id, clinicId: central.id, invoiceId: reversedInvoice.invoice.id,
        kind: 'REFUND', tender: 'CASH', amount: reversedInvoice.patientShare, receivedAt: at(-20, 6),
        receivedByStaffId: staff.finance, reversesPaymentId: wrong.id, reversedAt: at(-20, 6),
        reversalReason: 'Recorded against the wrong patient at the counter',
      },
    });
    await tx.payment.update({ where: { id: wrong.id }, data: { reversedAt: at(-20, 6) } });

    // --- OUTSTANDING invoices at several ages -----------------------------
    for (const [index, offset] of [-15, -45, -75, -120].entries()) {
      await makeVisit({
        patientIndex: index,
        clinicId: index % 2 === 0 ? central.id : branch.id,
        doctorKey: index % 2 === 0 ? 'owner' : 'locum',
        dayOffset: offset,
        lines: [{ description: 'General Consultation', amount: CONSULT }, { description: 'Wound Dressing', amount: DRESSING }],
      });
    }

    // --- A CREDIT NOTE, issued --------------------------------------------
    const credited = await makeVisit({ patientIndex: 2, clinicId: central.id, doctorKey: 'owner', dayOffset: -10, lines: [{ description: 'Antenatal Review', amount: ANTENATAL }, { description: 'Folic Acid 5mg', amount: Number(items.FOL5.sellPrice), taxable: false }] });
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

    console.log(`  finance: ${visitSeq} visits, cash/card/QR, partial, refund, reversal, 2 credit notes, 1 closed day`);
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
      await tx.invoiceLine.create({
        data: { tenantId: tenant.id, invoiceId: invoice.id, description: 'Consultation and medication', quantity: 1, unitPrice: amount, amount },
      });
      return { visit, invoice, panel };
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
          claimedAmount: amount, feeAmount: fee, claimStatus: 'BATCHED', createdAt: at(dayOffset, 8),
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
    const paidReceivable = 120 + paidClaim.fee;
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
    await tx.claimBatchLine.update({
      where: { id: partialClaim.line.id },
      data: {
        claimStatus: 'PARTIALLY_PAID', status: 'PAID',
        approvedAmount: 180, rejectedAmount: 57.6, rejectionReason: 'Consultation cap exceeded for this member',
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
    await tx.claimBatchLine.update({
      where: { id: rejectedClaim.line.id },
      data: {
        claimStatus: 'RESUBMITTED', status: 'REJECTED',
        approvedAmount: 0, rejectedAmount: 165, rejectionReason: 'Medication not on the member’s formulary',
        adjudicatedAt: at(-28, 4), resolvedAt: at(-26, 2), resolutionNote: 'Re-claimed under a new claim number',
      },
    });
    const replacementBatch = await tx.claimBatch.create({
      data: { tenantId: tenant.id, panelClinicId: panels[1].id, batchNumber: nextNumber('CLAIM'), createdByStaffId: staff.panel, createdAt: at(-26, 2) },
    });
    const replacement = await tx.claimBatchLine.create({
      data: {
        tenantId: tenant.id, claimBatchId: replacementBatch.id, invoiceId: rejectedVisit.invoice.id,
        // The re-claim pursues the SAME base amount as the line it supersedes
        // (160 + the panel's RM5 add-on = the 165 receivable that was rejected).
        // Re-claiming 165 as the base would quietly inflate the receivable by
        // one more fee every time a claim bounces.
        claimedAmount: 160, feeAmount: 5, claimStatus: 'SUBMITTED',
        supersedesLineId: rejectedClaim.line.id, responsibleStaffId: staff.panel,
        panelClaimNo: 'SJ-2026-0517', submittedAt: at(-25, 9), dueDate: day(20),
        remarks: 'Formulary exception approved by the panel by telephone',
        createdAt: at(-26, 2),
      },
    });
    await tx.claimEvent.createMany({
      data: [
        { tenantId: tenant.id, claimBatchLineId: rejectedClaim.line.id, eventType: 'ADJUDICATED', fromStatus: 'SUBMITTED', toStatus: 'REJECTED', amount: 0, reason: 'Medication not on the member’s formulary', actorStaffId: staff.panel, createdAt: at(-28, 4) },
        { tenantId: tenant.id, claimBatchLineId: rejectedClaim.line.id, eventType: 'RESUBMITTED', fromStatus: 'REJECTED', toStatus: 'RESUBMITTED', amount: 165, reference: replacementBatch.batchNumber, actorStaffId: staff.panel, createdAt: at(-26, 2) },
        { tenantId: tenant.id, claimBatchLineId: replacement.id, eventType: 'CREATED_AS_REPLACEMENT', toStatus: 'READY', amount: 165, reason: 'Formulary exception approved by the panel by telephone', actorStaffId: staff.panel, createdAt: at(-26, 2) },
      ],
    });

    // 4. SUBMITTED AND OVERDUE — past the panel's own payment term.
    const overdueVisit = await panelVisit(2, 3, -95, 95, branch.id, 'locum');
    const overdueClaim = await claim(2, overdueVisit.invoice.id, 95, -95);
    await submit(overdueClaim.batch.id, overdueClaim.line.id, -94, 'KS-2026-0031', 60);

    // 5. AWAITING SUBMISSION — one complete, one missing a diagnosis.
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

    console.log('  panel: paid, partially paid, rejected→re-claimed, overdue, ready, incomplete');
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

    const profiles: { key: string; position: string; salary: number | null; type: 'PERMANENT' | 'LOCUM' | 'CONTRACT' }[] = [
      { key: 'owner', position: 'Principal Doctor / Owner', salary: 18000, type: 'PERMANENT' },
      { key: 'resident', position: 'Resident Medical Officer', salary: 9500, type: 'PERMANENT' },
      { key: 'locum', position: 'Locum Doctor', salary: null, type: 'LOCUM' },
      { key: 'counter', position: 'Senior Clinic Assistant', salary: 3200, type: 'PERMANENT' },
      { key: 'counter2', position: 'Clinic Assistant', salary: 2600, type: 'PERMANENT' },
      { key: 'stock', position: 'Stock Controller', salary: 2900, type: 'PERMANENT' },
      { key: 'finance', position: 'Finance Executive', salary: 4200, type: 'PERMANENT' },
      // Deliberately WITHOUT a salary: the payroll run must surface this person
      // as an exception rather than paying them nothing.
      { key: 'panel', position: 'Panel Claims Executive', salary: null, type: 'CONTRACT' },
    ];

    for (const [index, profile] of profiles.entries()) {
      await tx.employeeProfile.create({
        data: {
          tenantId: tenant.id, staffId: staff[profile.key],
          employeeNo: `E-${String(1001 + index)}`,
          position: profile.position,
          department: profile.key.startsWith('counter') ? 'Front Office' : profile.key === 'stock' ? 'Pharmacy' : profile.key === 'finance' ? 'Finance' : 'Clinical',
          employmentType: profile.type,
          employmentStatus: 'ACTIVE',
          startDate: day(-500 - index * 30),
          basicSalary: profile.salary,
          hourlyRate: profile.type === 'LOCUM' ? 120 : null,
          leavePolicyId: policy.id,
          managerStaffId: profile.key === 'owner' ? null : staff.owner,
          phone: `013-200000${index}`,
          email: `${profile.key}@${DOMAIN}`,
          bankName: 'Bank Contoh',
          bankAccountNo: `1234567${index}`,
          epfApplicable: profile.type !== 'LOCUM',
          socsoApplicable: profile.type !== 'LOCUM',
          eisApplicable: profile.type !== 'LOCUM',
        },
      });
    }

    // --- Attendance across the current month ------------------------------
    const attendanceStaff = ['counter', 'counter2', 'stock', 'finance'];
    for (let offset = -20; offset <= -1; offset += 1) {
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
    await tx.leaveRequest.create({
      data: {
        tenantId: tenant.id, staffId: staff.finance, leaveType: 'UNPAID',
        startDate: day(-6), endDate: day(-6), reason: 'Personal', status: 'APPROVED',
        approvedByStaffId: staff.owner, approvedAt: at(-8, 2),
      },
    });

    // --- Staff medical benefit ---------------------------------------------
    const benefitYear = new Date().getUTCFullYear();
    const account = await tx.staffBenefitAccount.create({
      data: { tenantId: tenant.id, staffId: staff.counter, benefitYear, allowance: 1500 },
    });
    await tx.staffBenefitMember.create({
      data: { tenantId: tenant.id, accountId: account.id, name: 'Nurul Hidayah', relationship: 'SELF' },
    });
    await tx.staffBenefitUsage.create({
      data: { tenantId: tenant.id, accountId: account.id, usedAt: day(-30), amount: 180, notes: 'Consultation and medication', recordedByStaffId: staff.finance },
    });

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

    // --- Payroll — deliberately WITHOUT statutory rates --------------------
    const payroll = await tx.payrollRun.create({
      data: {
        tenantId: tenant.id, clinicId: central.id, period: monthStart(-1), status: 'CALCULATED',
        statutoryStatus: 'NOT_CONFIGURED', createdByStaffId: staff.finance, calculatedAt: at(-2, 8),
        exceptions: [{ staffId: staff.panel, name: 'Wan Azman', issue: 'No salary or hourly rate on record — this employee cannot be paid until one is set.' }] as never,
      },
    });
    let gross = 0;
    for (const profile of profiles.filter((entry) => entry.salary !== null && entry.key !== 'locum')) {
      const basic = profile.salary!;
      const incentives = profile.key === 'resident' ? 260 : 0;
      const overtimePay = profile.key === 'counter' ? 4 * 1.5 * Math.round((basic / (26 * 8)) * 100) / 100 : 0;
      const grossPay = Math.round((basic + incentives + overtimePay) * 100) / 100;
      gross += grossPay;
      await tx.payrollLine.create({
        data: {
          tenantId: tenant.id, payrollRunId: payroll.id, staffId: staff[profile.key],
          employeeSnapshot: { name: profile.key, position: profile.position, employmentType: profile.type } as never,
          basicSalary: basic, incentives, overtimePay, grossPay,
          // NULL, not zero: no statutory rates are configured for this period.
          epfEmployee: null, epfEmployer: null, socsoEmployee: null, socsoEmployer: null,
          eisEmployee: null, eisEmployer: null, pcb: null,
          netPay: grossPay, employerCost: grossPay,
          workedDays: 20, unpaidDays: profile.key === 'finance' ? 1 : 0,
          overtimeHours: profile.key === 'counter' ? 4 : 0,
          breakdown: { statutoryNotes: { epf: 'No statutory rate configured for this period.' }, incomplete: true } as never,
        },
      });
    }
    await tx.payrollRun.update({
      where: { id: payroll.id },
      data: { grossTotal: gross, deductionTotal: 0, netTotal: gross, employerCostTotal: gross, employeeCount: profiles.filter((p) => p.salary !== null && p.key !== 'locum').length },
    });

    console.log('  workforce: 8 employees, 20 days attendance, leave, incentive run, payroll with 1 exception');
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
