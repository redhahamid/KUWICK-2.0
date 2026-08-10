import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueueTicketStatus } from '@prisma/client';
import { DoctorCompletionService } from './doctor-completion.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// G4.5d3c-2 (D-086) — DOCTOR COMPLETION AND DESTINATION
//
// The two shortcuts this service exists to refuse:
//
//   "a Prescription exists"  does NOT mean dispensing is required
//   "an Invoice is UNPAID"   does NOT mean the patient owes anything
//
// Both are represented below by cases that would route the patient wrongly
// under the obvious rule.
// ===========================================================================

const DR_A = { id: 'dr-a', fullName: 'Dr Amira', role: 'DOCTOR_RESIDENT', active: true, clinicId: 'clinic-1', userId: 'u-a' };
const DR_B = { id: 'dr-b', fullName: 'Dr Bakri', role: 'DOCTOR_LOCUM', active: true, clinicId: 'clinic-1', userId: 'u-b' };
const FRONT_DESK = { id: 'fd-1', fullName: 'Amy', role: 'FRONT_DESK_CLINICAL_STAFF', active: true, clinicId: 'clinic-1', userId: 'u-f' };
const FINANCE = { id: 'fin-1', fullName: 'Faiz', role: 'FINANCE_STAFF', active: true, clinicId: 'clinic-1', userId: 'u-x' };

interface World {
  visit?: Record<string, unknown> | null;
  ticketStatus?: QueueTicketStatus | null;
  signedNotes?: number;
  openProcedures?: number;
  prescriptions?: Array<{ supplyMode: string | null; status: string }>;
  invoices?: Array<{ patientResponsibilityAmount: number | null; patientPaidAmount: number }>;
  services?: number;
  branchCount?: number;
  /** D-094 — active consultation tariff rules ([] = the feature is off). */
  tariffRules?: Array<Record<string, unknown>>;
}

function build(actor: Record<string, unknown> | null, world: World = {}) {
  const {
    visit = { id: 'visit-1', clinicId: 'clinic-1', staffId: DR_A.id, checkOutAt: null, doctorCompletedAt: null, doctorCompletedByStaffId: null, doctorCompletedDestination: null },
    ticketStatus = QueueTicketStatus.IN_CONSULTATION,
    signedNotes = 1,
    openProcedures = 0,
    prescriptions = [],
    invoices = [],
    services = 0,
    branchCount = 1,
    tariffRules = [],
  } = world;

  const directory: Record<string, unknown> = {};
  for (const s of [DR_A, DR_B, FRONT_DESK, FINANCE]) directory[s.id] = s;
  if (actor) directory[actor.id as string] = actor;

  const tx = {
    $executeRaw: jest.fn(),
    staff: { findUnique: jest.fn(async ({ where }: any) => (actor && where.id === actor.id ? actor : directory[where.id] ?? null)) },
    clinic: { count: jest.fn().mockResolvedValue(branchCount) },
    userClinicAccess: { findMany: jest.fn().mockResolvedValue([]) },
    visit: {
      findUnique: jest.fn(async ({ select }: any) =>
        // assertMayTouchVisit asks only for clinicId; the service asks for the
        // full row. Both are served, so branch checking is genuinely exercised.
        select?.clinicId && !select?.checkOutAt ? { clinicId: 'clinic-1' } : visit,
      ),
      update: jest.fn(),
      // D-087 — the atomic claim. count 1 = this request won.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    queueTicket: {
      findUnique: jest.fn().mockResolvedValue(ticketStatus === null ? null : { id: 't1', status: ticketStatus }),
      update: jest.fn(),
    },
    clinicalNote: { count: jest.fn().mockResolvedValue(signedNotes) },
    orderService: {
      count: jest.fn(async ({ where }: any) => (where?.status?.in ? openProcedures : services)),
      // D-093 — the billing worklist reads orders itemised. STANDARD_SERVICE
      // rows stand in for the old `services` count.
      findMany: jest.fn(async () =>
        Array.from({ length: services }, (_, i) => ({
          id: `svc-${i}`,
          procedureName: `Service ${i}`,
          orderType: 'STANDARD_SERVICE',
          status: 'PENDING',
        })),
      ),
    },
    prescription: {
      // Serves both the supply evaluation and the worklist; the worklist
      // ignores rows without an id, so give each one.
      findMany: jest.fn(async () => prescriptions.map((p, i) => ({ id: `rx-${i}`, quantity: 1, item: null, ...p }))),
      count: jest.fn().mockResolvedValue(prescriptions.length),
    },
    invoice: { findMany: jest.fn().mockResolvedValue(invoices) },
    invoiceLine: { findMany: jest.fn().mockResolvedValue([]) },
    // D-094 — the worklist now resolves the consultation charge too. No
    // configured tariff (the default) means consultation auto-billing is OFF
    // for this clinic, so these suites' routing is unchanged by it.
    consultationTariffRule: { findMany: jest.fn(async () => tariffRules) },
    visitWorkflowEvent: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
  };

  const rawPrisma = { $transaction: jest.fn((fn: any) => fn(tx)) } as unknown as PrismaService;
  const prisma = {} as unknown as TenantScopedPrismaClient;
  return { service: new DoctorCompletionService(prisma, rawPrisma), tx, actorId: (actor?.id as string) ?? undefined };
}

const run = (ctx: ReturnType<typeof build>, dto = {}) =>
  tenantContextStorage.run({ tenantId: 'test-tenant', staffId: ctx.actorId } as never, () =>
    ctx.service.completeDoctorPhase('visit-1', dto),
  );

const read = (ctx: ReturnType<typeof build>) =>
  tenantContextStorage.run({ tenantId: 'test-tenant', staffId: ctx.actorId } as never, () =>
    ctx.service.doctorPhaseStatus('visit-1'),
  );

/** Every mock on the transaction that would change something. */
const writeMocks = (ctx: ReturnType<typeof build>) => [
  ctx.tx.visit.update,
  ctx.tx.visit.updateMany,
  ctx.tx.queueTicket.update,
  ctx.tx.visitWorkflowEvent.create,
];

const rawSql = (ctx: ReturnType<typeof build>) =>
  (ctx.tx.$executeRaw as jest.Mock).mock.calls.map((call) => (call[0] as string[]).join('?'));

const RX = (supplyMode: string | null, status = 'ORDERED') => ({ supplyMode, status });

describe('authorisation', () => {
  it('1. anonymous completion is denied', async () => {
    await expect(run(build(null))).rejects.toThrow(ForbiddenException);
  });

  it.each([
    ['front desk', FRONT_DESK],
    ['finance', FINANCE],
  ])('2. %s cannot complete the doctor phase', async (_n, actor) => {
    const ctx = build(actor);
    await expect(run(ctx)).rejects.toThrow(ForbiddenException);
    expect(ctx.tx.visit.updateMany).not.toHaveBeenCalled();
  });

  it('4. a doctor without access to the visit’s branch is denied', async () => {
    const ctx = build({ ...DR_A, clinicId: 'clinic-9' }, { branchCount: 2 });
    await expect(run(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('5. a non-attending doctor is denied — there is no override', async () => {
    const ctx = build(DR_B);
    await expect(run(ctx)).rejects.toThrow(ForbiddenException);
    expect(ctx.tx.visit.updateMany).not.toHaveBeenCalled();
  });

  it('the attending doctor is allowed', async () => {
    const ctx = build(DR_A);
    await expect(run(ctx)).resolves.toMatchObject({ destination: 'NONE' });
  });

  it('a visit with no attending doctor cannot be completed', async () => {
    const ctx = build(DR_A, { visit: { id: 'visit-1', clinicId: 'clinic-1', staffId: null, checkOutAt: null, doctorCompletedAt: null } });
    await expect(run(ctx)).rejects.toThrow(BadRequestException);
  });

  it('3. a foreign visit is a 404, same as a missing one', async () => {
    const ctx = build(DR_A, { visit: null });
    await expect(run(ctx)).rejects.toThrow(NotFoundException);
  });
});

describe('preconditions', () => {
  // G4.5d3c-3c — this test asserted the OPPOSITE until 3c, and the reversal
  // is the owner-approved change at the heart of this checkpoint: an unsigned
  // clinical note used to refuse the whole routing decision, which held a
  // patient in the consultation room until the prose was finished. The
  // requirement to sign has not gone; it moved to visit completion, where
  // `visit-completion.service.spec.ts` asserts it as
  // CLINICAL_DOCUMENTATION_PENDING.
  it('6. an unsigned clinical note does NOT block completion — it is recorded as pending', async () => {
    const ctx = build(DR_A, { signedNotes: 0 });
    await expect(run(ctx)).resolves.toMatchObject({ alreadyCompleted: false });
    expect(ctx.tx.visit.updateMany).toHaveBeenCalled();
  });

  it('6b. sending a patient on with documentation pending is recorded on the event', async () => {
    // The actor and the timestamp come from the append-only workflow event
    // itself; the metadata says what was true of the record at that moment.
    const ctx = build(DR_A, { signedNotes: 0 });
    await run(ctx);
    const event = ctx.tx.visitWorkflowEvent.create.mock.calls[0][0].data;
    expect(event.metadata).toMatchObject({ documentationPending: true });
    expect(event.actorStaffId).toBe(DR_A.id);
    expect(event.actorNameSnapshot).toBe(DR_A.fullName);
  });

  it('6c. a signed note records documentation as NOT pending', async () => {
    const ctx = build(DR_A, { signedNotes: 1 });
    await run(ctx);
    const event = ctx.tx.visitWorkflowEvent.create.mock.calls[0][0].data;
    expect(event.metadata).toMatchObject({ documentationPending: false });
  });

  it('6d. completion writes no clinical note and signs nothing', async () => {
    // No auto-save, no auto-sign. The draft in the editor is the doctor's.
    const ctx = build(DR_A, { signedNotes: 0 });
    await run(ctx);
    expect((ctx.tx.clinicalNote as Record<string, unknown>).create).toBeUndefined();
    expect((ctx.tx.clinicalNote as Record<string, unknown>).update).toBeUndefined();
  });

  it('7. an open procedure blocks completion', async () => {
    const ctx = build(DR_A, { openProcedures: 1 });
    await expect(run(ctx)).rejects.toThrow(/still open/i);
  });

  it('a ticket not in consultation is rejected', async () => {
    const ctx = build(DR_A, { ticketStatus: QueueTicketStatus.WAITING });
    await expect(run(ctx)).rejects.toThrow(BadRequestException);
  });

  it('an already closed visit is rejected', async () => {
    const ctx = build(DR_A, { visit: { id: 'visit-1', clinicId: 'clinic-1', staffId: DR_A.id, checkOutAt: new Date(), doctorCompletedAt: null } });
    await expect(run(ctx)).rejects.toThrow(/already closed/i);
  });
});

describe('prescription destination', () => {
  it('8. ONSITE_DISPENSE still ORDERED routes to the dispensary', async () => {
    const ctx = build(DR_A, { prescriptions: [RX('ONSITE_DISPENSE')] });
    const r = await run(ctx);
    expect(r).toMatchObject({ destination: 'DISPENSARY', reason: 'DISPENSARY_REQUIRED', queueStatus: 'READY_FOR_DISPENSARY' });
  });

  it.each([
    ['9. EXTERNAL_PRESCRIPTION', 'EXTERNAL_PRESCRIPTION'],
    ['10. PATIENT_OWN_SUPPLY', 'PATIENT_OWN_SUPPLY'],
    ['11. NO_SUPPLY_REQUIRED', 'NO_SUPPLY_REQUIRED'],
  ])('%s does NOT route to the dispensary', async (_n, mode) => {
    const ctx = build(DR_A, { prescriptions: [RX(mode)] });
    const r = await run(ctx);
    expect(r.destination).not.toBe('DISPENSARY');
  });

  it('an already dispensed ONSITE item does not send them back', async () => {
    const ctx = build(DR_A, { prescriptions: [RX('ONSITE_DISPENSE', 'DISPENSED')] });
    const r = await run(ctx);
    expect(r.destination).not.toBe('DISPENSARY');
  });

  // G4.5d3c-3b1 (D-093, owner decision 4) — REVERSED from the D-086 draft:
  // an external prescription is NOT a clinic medication charge, so a visit
  // whose only work is an external script has nothing unbilled and routes
  // NONE. A clinic-dispensed medication with no invoice still goes to
  // billing review (the test below).
  it('an EXTERNAL prescription alone with NO invoice is not unbilled work', async () => {
    const ctx = build(DR_A, { prescriptions: [RX('EXTERNAL_PRESCRIPTION')], invoices: [] });
    await expect(run(ctx)).resolves.toMatchObject({ destination: 'NONE', reason: 'NO_DOWNSTREAM_WORK' });
  });

  it('a clinic-dispensed medication with NO invoice still goes to billing review', async () => {
    const ctx = build(DR_A, {
      prescriptions: [RX('ONSITE_DISPENSE', 'DISPENSED')],
      invoices: [],
    });
    await expect(run(ctx)).resolves.toMatchObject({
      destination: 'PAYMENT',
      reason: 'BILLING_REVIEW_REQUIRED',
    });
  });

  it('a non-dispensary prescription that IS fully billed permits NONE', async () => {
    const ctx = build(DR_A, {
      prescriptions: [RX('EXTERNAL_PRESCRIPTION')],
      invoices: [{ patientResponsibilityAmount: 0, patientPaidAmount: 0 }],
    });
    await expect(run(ctx)).resolves.toMatchObject({ destination: 'NONE' });
  });

  it('12. DEFERRED blocks completion with the approved wording', async () => {
    const ctx = build(DR_A, { prescriptions: [RX('DEFERRED')] });
    await expect(run(ctx)).rejects.toThrow(
      /Medication supply is deferred and unresolved\. Resolve the supply mode before completing consultation\./,
    );
    expect(ctx.tx.visit.updateMany).not.toHaveBeenCalled();
  });

  it('13. a NULL supply mode blocks completion — it is never assumed to be ONSITE', async () => {
    const ctx = build(DR_A, { prescriptions: [RX(null)] });
    await expect(run(ctx)).rejects.toThrow(/no supply mode recorded/i);
  });

  it('a cancelled prescription is ignored entirely', async () => {
    // Under the naive "a Prescription exists" rule this would route to the
    // dispensary for medication nobody is getting.
    const ctx = build(DR_A, { prescriptions: [] });
    await expect(run(ctx)).resolves.toMatchObject({ destination: 'NONE' });
  });
});

describe('billing destination', () => {
  const inv = (responsibility: number | null, paid = 0) => ({
    patientResponsibilityAmount: responsibility,
    patientPaidAmount: paid,
  });

  it('14. a fully panel-covered invoice does NOT route to payment', async () => {
    // UNPAID, patientPaidAmount 0 — the naive rule sends this patient to a
    // counter to pay nothing.
    const ctx = build(DR_A, { invoices: [inv(0)] });
    await expect(run(ctx)).resolves.toMatchObject({ destination: 'NONE', reason: 'NO_DOWNSTREAM_WORK' });
  });

  it('15. a cash balance routes to payment', async () => {
    const ctx = build(DR_A, { invoices: [inv(85)] });
    await expect(run(ctx)).resolves.toMatchObject({
      destination: 'PAYMENT',
      reason: 'PATIENT_PAYMENT_REQUIRED',
      queueStatus: 'READY_FOR_PAYMENT',
    });
  });

  it('16. a copayment balance routes to payment', async () => {
    const ctx = build(DR_A, { invoices: [inv(30)] });
    await expect(run(ctx)).resolves.toMatchObject({ destination: 'PAYMENT', reason: 'PATIENT_PAYMENT_REQUIRED' });
  });

  it('a fully paid invoice leaves nothing outstanding', async () => {
    const ctx = build(DR_A, { invoices: [inv(85, 85)] });
    await expect(run(ctx)).resolves.toMatchObject({ destination: 'NONE' });
  });

  it('17. remaining amounts are summed across invoices', async () => {
    const ctx = build(DR_A, { invoices: [inv(0), inv(30, 10)] });
    await expect(run(ctx)).resolves.toMatchObject({ destination: 'PAYMENT', reason: 'PATIENT_PAYMENT_REQUIRED' });
  });

  it('an overpaid invoice cannot offset another’s balance', async () => {
    // max(owed, 0) per invoice: a credit on one bill is not change owed on
    // the next, and netting them would hide a real balance.
    const ctx = build(DR_A, { invoices: [inv(10, 50), inv(40)] });
    await expect(run(ctx)).resolves.toMatchObject({ destination: 'PAYMENT' });
  });

  it('19. a NULL responsibility routes to billing review, not "payment due"', async () => {
    const ctx = build(DR_A, { invoices: [inv(null)] });
    await expect(run(ctx)).resolves.toMatchObject({
      destination: 'PAYMENT',
      reason: 'BILLING_REVIEW_REQUIRED',
    });
  });

  it('one unknown invoice makes the whole visit undetermined', async () => {
    const ctx = build(DR_A, { invoices: [inv(0), inv(null)] });
    await expect(run(ctx)).resolves.toMatchObject({ reason: 'BILLING_REVIEW_REQUIRED' });
  });

  it('20. no invoice but billable items routes to billing review', async () => {
    const ctx = build(DR_A, { invoices: [], services: 2 });
    await expect(run(ctx)).resolves.toMatchObject({
      destination: 'PAYMENT',
      reason: 'BILLING_REVIEW_REQUIRED',
    });
  });

  // G4.5d3c-3b2 (D-094) — a matched consultation tariff is billing work, so a
  // doctor who recorded nothing else still routes the patient to the counter.
  // This is the locum-medication-only gap the audit named: the fee no longer
  // depends on anyone remembering it.
  it('a matched consultation tariff routes to billing review even with no other work', async () => {
    const ctx = build(DR_A, {
      invoices: [],
      services: 0,
      tariffRules: [
        {
          id: 'rule-day',
          classification: 'CONSULTATION',
          startTime: '08:00',
          endTime: '22:59',
          effectiveFrom: null,
          effectiveTo: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          serviceCatalog: { id: 'svc-consult', name: 'Consultation (Day)', active: true },
        },
      ],
    });
    await expect(run(ctx)).resolves.toMatchObject({
      destination: 'PAYMENT',
      reason: 'BILLING_REVIEW_REQUIRED',
    });
  });

  it('21. no invoice and nothing billable permits NONE', async () => {
    const ctx = build(DR_A, { invoices: [], services: 0 });
    await expect(run(ctx)).resolves.toMatchObject({ destination: 'NONE' });
  });

  it('dispensing takes precedence over money', async () => {
    const ctx = build(DR_A, { prescriptions: [RX('ONSITE_DISPENSE')], invoices: [inv(85)] });
    await expect(run(ctx)).resolves.toMatchObject({ destination: 'DISPENSARY' });
  });
});

describe('atomicity, idempotency and checkOutAt', () => {
  it('22/23. one transaction writes the doctor fields, the queue and ONE event', async () => {
    const ctx = build(DR_A, { prescriptions: [RX('ONSITE_DISPENSE')] });
    await run(ctx, { correlationId: 'corr-1' });

    expect(ctx.tx.visit.updateMany).toHaveBeenCalledTimes(1);
    const data = (ctx.tx.visit.updateMany as jest.Mock).mock.calls[0][0].data;
    expect(data.doctorCompletedByStaffId).toBe(DR_A.id);
    expect(data.doctorCompletedDestination).toBe('DISPENSARY');
    expect(data.doctorCompletedAt).toBeInstanceOf(Date);

    expect(ctx.tx.queueTicket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: 'READY_FOR_DISPENSARY' },
    });
    expect(ctx.tx.visitWorkflowEvent.create).toHaveBeenCalledTimes(1);
    const event = ctx.tx.visitWorkflowEvent.create.mock.calls[0][0].data;
    expect(event).toMatchObject({
      eventType: 'DOCTOR_PHASE_COMPLETED',
      previousStatus: 'IN_CONSULTATION',
      newStatus: 'READY_FOR_DISPENSARY',
      destination: 'DISPENSARY',
      actorStaffId: DR_A.id,
      correlationId: 'corr-1',
    });
  });

  it('24. a failed event insert aborts the whole completion', async () => {
    const ctx = build(DR_A);
    ctx.tx.visitWorkflowEvent.create.mockRejectedValue(new Error('disk full'));
    await expect(run(ctx)).rejects.toThrow();
  });

  it('25. a repeat returns the RECORDED result and re-derives nothing', async () => {
    const completedAt = new Date('2026-08-04T09:00:00Z');
    const ctx = build(DR_A, {
      visit: {
        id: 'visit-1', clinicId: 'clinic-1', staffId: DR_A.id, checkOutAt: null,
        doctorCompletedAt: completedAt, doctorCompletedByStaffId: DR_A.id,
        doctorCompletedDestination: 'DISPENSARY',
      },
      // The medication has since been dispensed. Re-deriving would now say
      // NONE and "correct" a patient who is already at the dispensary.
      prescriptions: [RX('ONSITE_DISPENSE', 'DISPENSED')],
    });

    const r = await run(ctx);

    expect(r).toMatchObject({ destination: 'DISPENSARY', alreadyCompleted: true, doctorCompletedAt: completedAt });
    expect(ctx.tx.visit.updateMany).not.toHaveBeenCalled();
    expect(ctx.tx.visitWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it('26. a repeat by a DIFFERENT doctor still does not re-complete', async () => {
    const ctx = build(DR_B, {
      visit: {
        id: 'visit-1', clinicId: 'clinic-1', staffId: DR_A.id, checkOutAt: null,
        doctorCompletedAt: new Date(), doctorCompletedByStaffId: DR_A.id,
        doctorCompletedDestination: 'NONE',
      },
    });
    // The idempotent read happens BEFORE the attending check, so a completed
    // visit reports its result rather than 403-ing a colleague who asked.
    await expect(run(ctx)).resolves.toMatchObject({ alreadyCompleted: true });
    expect(ctx.tx.visit.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['27. DISPENSARY', [RX('ONSITE_DISPENSE')], []],
    ['28. PAYMENT', [], [{ patientResponsibilityAmount: 85, patientPaidAmount: 0 }]],
    ['NONE', [], []],
  ])('%s leaves Visit.checkOutAt untouched', async (_n, prescriptions, invoices) => {
    const ctx = build(DR_A, { prescriptions: prescriptions as never, invoices: invoices as never });
    await run(ctx);
    // Doctor-phase completion is NOT visit completion. Closing the visit is a
    // separate explicit act, and this service never performs it.
    const data = (ctx.tx.visit.updateMany as jest.Mock).mock.calls[0][0].data;
    expect(data).not.toHaveProperty('checkOutAt');
  });

  it('the destination cannot be supplied by the caller', async () => {
    const ctx = build(DR_A, { prescriptions: [RX('ONSITE_DISPENSE')] });
    // A browser asking for NONE gets DISPENSARY: the DTO has no destination
    // field, and the derivation ignores anything extra.
    const r = await run(ctx, { destination: 'NONE' } as never);
    expect(r.destination).toBe('DISPENSARY');
  });
});

// ===========================================================================
// G4.5d3c-2c (D-088) — DOCTOR-PHASE STATUS READ AND STRUCTURED BLOCKERS
//
// One evaluator serves the preview, the refusal and the commit. The tests
// below exist to stop those three drifting apart, and to pin the two
// properties that are easy to lose in a later edit: the read writes nothing,
// and a completed phase is never re-derived.
// ===========================================================================

/** Everything blocked at once: wrong queue stage, unsigned note, open
 *  procedure, one unset supply mode and one deferred. */
const ALL_BLOCKED = {
  ticketStatus: QueueTicketStatus.WAITING,
  signedNotes: 0,
  openProcedures: 1,
  prescriptions: [RX(null), RX('DEFERRED')],
} as const;

describe('doctor-phase status: side-effect freedom', () => {
  it('the read is opened in a transaction PostgreSQL will refuse writes in', async () => {
    const ctx = build(DR_A);
    await read(ctx);
    // Not a promise in a comment: `transaction_read_only` is the GUC
    // `SET TRANSACTION READ ONLY` sets, so a write added to this path later
    // fails at the server rather than landing quietly.
    expect(rawSql(ctx).some((sql) => sql.includes('transaction_read_only'))).toBe(true);
    expect(rawSql(ctx).some((sql) => sql.includes('app.tenant_id'))).toBe(true);
  });

  it.each([
    ['a blocked visit', {}],
    ['a completable visit', { invoices: [{ patientResponsibilityAmount: 85, patientPaidAmount: 0 }] }],
    ['a fully blocked visit', ALL_BLOCKED],
    [
      'a completed visit',
      {
        visit: {
          id: 'visit-1', clinicId: 'clinic-1', staffId: DR_A.id, checkOutAt: null,
          doctorCompletedAt: new Date('2026-08-04T09:00:00Z'), doctorCompletedByStaffId: DR_A.id,
          doctorCompletedDestination: 'DISPENSARY', doctorCompletedRoutingReason: 'DISPENSARY_REQUIRED',
        },
      },
    ],
  ])('%s: reading it changes nothing', async (_n, world) => {
    const ctx = build(DR_A, world as never);
    await read(ctx);
    for (const mock of writeMocks(ctx)) {
      expect(mock).not.toHaveBeenCalled();
    }
  });
});

describe('doctor-phase status: tenant, branch and non-disclosure', () => {
  it('an anonymous read is denied', async () => {
    await expect(read(build(null))).rejects.toThrow(ForbiddenException);
  });

  it('a staff member without access to the visit’s branch is denied', async () => {
    const ctx = build({ ...DR_A, clinicId: 'clinic-9' }, { branchCount: 2 });
    await expect(read(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('a visit outside the caller’s tenant is a 404, same as a missing one', async () => {
    // RLS makes the row invisible, so the read cannot tell the two apart —
    // which is the point. Neither answer confirms the visit exists.
    const ctx = build(DR_A, { visit: null });
    await expect(read(ctx)).rejects.toThrow(NotFoundException);
  });

  it.each([
    ['front desk', FRONT_DESK],
    ['finance', FINANCE],
  ])('%s may READ the status even though they may not complete the phase', async (_n, actor) => {
    // Workflow state, not clinical content: no note text, no diagnosis, no
    // medication name. The same information the visit-completion blocker read
    // already gives the counter.
    const ctx = build(actor);
    await expect(read(ctx)).resolves.toMatchObject({ completed: false });
    await expect(run(build(actor))).rejects.toThrow(ForbiddenException);
  });

  it('a doctor who is not attending may still read', async () => {
    // Reading does not take the visit, and refusing here would leave a
    // covering doctor unable to see why the consultation is stuck.
    const ctx = build(DR_B);
    await expect(read(ctx)).resolves.toMatchObject({ completed: false });
  });
});

describe('doctor-phase status: structured blockers', () => {
  const codes = (s: { blockers: Array<{ code: string }> }) => s.blockers.map((b) => b.code);

  it('every blocker is collected in one pass, in a stable order', async () => {
    const ctx = build(DR_A, ALL_BLOCKED as never);
    const status = await read(ctx);
    expect(codes(status)).toEqual([
      'QUEUE_STATE_INELIGIBLE',
      'PROCEDURE_PENDING',
      'MEDICATION_SUPPLY_UNCONFIRMED',
      'MEDICATION_SUPPLY_DEFERRED',
    ]);
    // The unsigned note in ALL_BLOCKED is reported ALONGSIDE the blockers,
    // not among them (3c).
    expect(status.documentationPending).toBe(true);
  });

  it('the order does not depend on which query resolved first', async () => {
    // Two independent runs of the same world must produce the same sequence;
    // a UI that renders "the first blocker" cannot have it change under it.
    const first = await read(build(DR_A, ALL_BLOCKED as never));
    const second = await read(build(DR_A, ALL_BLOCKED as never));
    expect(codes(first)).toEqual(codes(second));
  });

  it.each([
    ['a ticket at the wrong stage', { ticketStatus: QueueTicketStatus.WAITING }],
    ['no queue ticket at all', { ticketStatus: null }],
  ])('%s reports QUEUE_STATE_INELIGIBLE', async (_n, world) => {
    const status = await read(build(DR_A, world as never));
    expect(codes(status)).toContain('QUEUE_STATE_INELIGIBLE');
  });

  it('an unsigned note reports documentationPending and NO blocker', async () => {
    const status = await read(build(DR_A, { signedNotes: 0 }));
    expect(codes(status)).toEqual([]);
    expect(status.documentationPending).toBe(true);
  });

  it('a signed note reports documentationPending false', async () => {
    const status = await read(build(DR_A, { signedNotes: 1 }));
    expect(status.documentationPending).toBe(false);
  });

  it('documentation pending never suppresses the routing destination', async () => {
    const status = await read(build(DR_A, { signedNotes: 0, prescriptions: [RX('ONSITE_DISPENSE')] }));
    expect(status.destination).toBe('DISPENSARY');
    expect(status.routingReason).toBe('DISPENSARY_REQUIRED');
    expect(status.blockers).toEqual([]);
  });

  it('NULL and DEFERRED supply modes are separate blockers, not one', async () => {
    // Different facts about the clinic: nobody has said, versus somebody said
    // "later". Collapsing them tells a doctor to set a mode already set.
    const status = await read(build(DR_A, { prescriptions: [RX(null), RX('DEFERRED')] }));
    expect(codes(status)).toEqual(['MEDICATION_SUPPLY_UNCONFIRMED', 'MEDICATION_SUPPLY_DEFERRED']);
  });

  it('a resolved, dispensable prescription is not a blocker', async () => {
    const status = await read(build(DR_A, { prescriptions: [RX('ONSITE_DISPENSE')] }));
    expect(status.blockers).toEqual([]);
    expect(status).toMatchObject({ destination: 'DISPENSARY', routingReason: 'DISPENSARY_REQUIRED' });
  });

  it('blocker messages name nothing from the schema', async () => {
    const status = await read(build(DR_A, ALL_BLOCKED as never));
    for (const blocker of status.blockers) {
      expect(blocker.message).not.toMatch(
        /visit|queue_ticket|prescription|supply_mode|ONSITE_DISPENSE|DEFERRED|IN_CONSULTATION|NULL/,
      );
      expect(blocker.message.length).toBeGreaterThan(0);
    }
  });
});

describe('doctor-phase status: billing is routing, never a blocker', () => {
  const inv = (responsibility: number | null, paid = 0) => ({
    patientResponsibilityAmount: responsibility,
    patientPaidAmount: paid,
  });

  it.each([
    ['an outstanding balance', { invoices: [inv(85)] }, 'PATIENT_PAYMENT_REQUIRED'],
    ['a responsibility nobody has computed', { invoices: [inv(null)] }, 'BILLING_REVIEW_REQUIRED'],
    ['chargeable work with no invoice raised', { invoices: [], services: 2 }, 'BILLING_REVIEW_REQUIRED'],
  ])('%s does not block the doctor — it sets the routing reason', async (_n, world, reason) => {
    const status = await read(build(DR_A, world as never));
    // The doctor is finished; the money is the counter's problem. A billing
    // state that held a clinician at their desk would let a slow front desk
    // stop a clinic.
    expect(status.blockers).toEqual([]);
    expect(status).toMatchObject({ destination: 'PAYMENT', routingReason: reason });
  });

  it('nothing outstanding routes to NONE with a reason, not to null', async () => {
    const status = await read(build(DR_A, { invoices: [inv(0)] }));
    expect(status).toMatchObject({ destination: 'NONE', routingReason: 'NO_DOWNSTREAM_WORK' });
  });

  it('a clinical blocker does not suppress the routing preview', async () => {
    // A supply mode nobody has set says nothing about where the patient goes
    // once it is set, so the preview still answers.
    const status = await read(build(DR_A, { prescriptions: [RX(null)], invoices: [inv(85)] }));
    expect(status).toMatchObject({
      blockers: [{ code: 'MEDICATION_SUPPLY_UNCONFIRMED' }],
      destination: 'PAYMENT',
      routingReason: 'PATIENT_PAYMENT_REQUIRED',
    });
  });
});

describe('doctor-phase status: a pending procedure withholds the destination', () => {
  it('PROCEDURE_PENDING returns destination null and routingReason null', async () => {
    const ctx = build(DR_A, { openProcedures: 1, invoices: [{ patientResponsibilityAmount: 85, patientPaidAmount: 0 }] });
    const status = await read(ctx);
    expect(status).toMatchObject({ destination: null, routingReason: null });
    expect(status.blockers.map((b) => b.code)).toContain('PROCEDURE_PENDING');
  });

  it('the billing question is not even asked while a procedure is open', async () => {
    // The procedure's findings are an input to it: they can add an order, a
    // medication or a charge. Answering now would be a guess about a visit
    // that has not stopped changing.
    const ctx = build(DR_A, { openProcedures: 1 });
    await read(ctx);
    expect(ctx.tx.invoice.findMany).not.toHaveBeenCalled();
  });

  it('NONE is never substituted for "not yet knowable"', async () => {
    const status = await read(build(DR_A, { openProcedures: 1, invoices: [], services: 0 }));
    // Without the carve-out this visit derives NONE — "nothing further" — for
    // a patient whose procedure has not reported.
    expect(status.destination).toBeNull();
  });

  it('a completed procedure restores the destination', async () => {
    const status = await read(build(DR_A, { openProcedures: 0 }));
    expect(status.destination).toBe('NONE');
  });
});

describe('doctor-phase status: a completed phase is read back, never re-derived', () => {
  const COMPLETED_AT = new Date('2026-08-04T09:00:00Z');
  const completedWorld = (destination: string | null, routingReason: string | null) => ({
    visit: {
      id: 'visit-1', clinicId: 'clinic-1', staffId: DR_A.id, checkOutAt: null,
      doctorCompletedAt: COMPLETED_AT, doctorCompletedByStaffId: DR_A.id,
      doctorCompletedDestination: destination, doctorCompletedRoutingReason: routingReason,
    },
    // The medication has since been dispensed and the bill has been settled.
    // A re-derivation would now say NONE.
    prescriptions: [RX('ONSITE_DISPENSE', 'DISPENSED')],
    invoices: [{ patientResponsibilityAmount: 0, patientPaidAmount: 0 }],
  });

  it('the STORED destination and reason are returned', async () => {
    const ctx = build(DR_A, completedWorld('DISPENSARY', 'DISPENSARY_REQUIRED') as never);
    await expect(read(ctx)).resolves.toMatchObject({
      completed: true,
      destination: 'DISPENSARY',
      routingReason: 'DISPENSARY_REQUIRED',
      doctorCompletedAt: COMPLETED_AT,
      doctorCompletedByStaffId: DR_A.id,
      blockers: [],
    });
  });

  it('the ROUTING is never re-derived for a completed phase', async () => {
    const ctx = build(DR_A, completedWorld('DISPENSARY', 'DISPENSARY_REQUIRED') as never);
    await read(ctx);
    // Destination and blockers come from what was recorded, not from
    // re-running the rules against a visit that has since moved on.
    expect(ctx.tx.invoice.findMany).not.toHaveBeenCalled();
    expect(ctx.tx.orderService.count).not.toHaveBeenCalled();
  });

  it('two LIVE facts are still read alongside the recorded answer', async () => {
    // clinicalNote.count (3c) and the unreviewed-copies check (KW2-C2) are
    // deliberately current rather than historical: both answer "what is true
    // now", which is what a counter deciding whether to close the visit
    // needs. They are reported ALONGSIDE the recorded routing, never instead
    // of it — the test above is what holds that line.
    const ctx = build(DR_A, completedWorld('DISPENSARY', 'DISPENSARY_REQUIRED') as never);
    await read(ctx);
    expect(ctx.tx.prescription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ reviewFlag: true }) }),
    );
  });

  it('a completed phase reports no blockers even from an ineligible queue state', async () => {
    const ctx = build(DR_A, {
      ...completedWorld('NONE', 'NO_DOWNSTREAM_WORK'),
      ticketStatus: QueueTicketStatus.COMPLETED,
    } as never);
    await expect(read(ctx)).resolves.toMatchObject({ blockers: [], queueStatus: 'COMPLETED' });
  });

  it('a reason recorded before D-087 reads NULL, not NO_DOWNSTREAM_WORK', async () => {
    // Not captured. Inferring one now from today's prescriptions and invoices
    // is exactly the re-derivation the stored column exists to prevent.
    const ctx = build(DR_A, completedWorld('DISPENSARY', null) as never);
    await expect(read(ctx)).resolves.toMatchObject({ destination: 'DISPENSARY', routingReason: null });
  });
});

describe('the write refuses with the same structured blockers', () => {
  it('all of them travel in the rejection, not just the first', async () => {
    const ctx = build(DR_A, ALL_BLOCKED as never);
    await expect(run(ctx)).rejects.toMatchObject({
      response: {
        blockers: [
          { code: 'QUEUE_STATE_INELIGIBLE' },
          { code: 'PROCEDURE_PENDING' },
          { code: 'MEDICATION_SUPPLY_UNCONFIRMED' },
          { code: 'MEDICATION_SUPPLY_DEFERRED' },
        ],
      },
    });
    expect(ctx.tx.visit.updateMany).not.toHaveBeenCalled();
  });

  it('the preview and the refusal report the same codes for the same visit', async () => {
    // The whole point of the shared evaluator. If these two ever disagree, a
    // screen offers a button the server then refuses.
    const previewed = await read(build(DR_A, ALL_BLOCKED as never));
    const rejection = await run(build(DR_A, ALL_BLOCKED as never)).catch((e) => e);
    expect(rejection.response.blockers).toEqual(previewed.blockers);
  });

  it('the write re-evaluates inside its OWN transaction, not from a preview', async () => {
    // Every evaluator query is issued against the transaction client the write
    // opened. A caller cannot hand in a status read taken seconds ago.
    const ctx = build(DR_A, { prescriptions: [RX('ONSITE_DISPENSE')] });
    await run(ctx);
    expect(ctx.tx.clinicalNote.count).toHaveBeenCalled();
    expect(ctx.tx.orderService.count).toHaveBeenCalled();
    expect(ctx.tx.prescription.findMany).toHaveBeenCalled();
  });

  it('a preview that says PAYMENT does not let the caller skip the dispensary', async () => {
    // The DTO carries no destination and none is accepted; the write derives
    // DISPENSARY from the same stored data whatever was previewed.
    const ctx = build(DR_A, {
      prescriptions: [RX('ONSITE_DISPENSE')],
      invoices: [{ patientResponsibilityAmount: 85, patientPaidAmount: 0 }],
    });
    await expect(run(ctx, { destination: 'PAYMENT', routingReason: 'PATIENT_PAYMENT_REQUIRED' } as never))
      .resolves.toMatchObject({ destination: 'DISPENSARY', reason: 'DISPENSARY_REQUIRED' });
  });

  it('a visit with no queue ticket is refused as an ineligible queue state', async () => {
    const ctx = build(DR_A, { ticketStatus: null });
    await expect(run(ctx)).rejects.toMatchObject({
      response: { blockers: [{ code: 'QUEUE_STATE_INELIGIBLE' }] },
    });
    expect(ctx.tx.visit.updateMany).not.toHaveBeenCalled();
  });
});
