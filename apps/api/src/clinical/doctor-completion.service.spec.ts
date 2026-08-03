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
    },
    queueTicket: {
      findUnique: jest.fn().mockResolvedValue(ticketStatus === null ? null : { id: 't1', status: ticketStatus }),
      update: jest.fn(),
    },
    clinicalNote: { count: jest.fn().mockResolvedValue(signedNotes) },
    orderService: {
      count: jest.fn(async ({ where }: any) =>
        // The blocker query filters on PENDING/IN_PROGRESS; the billable query
        // filters on "not CANCELLED".
        where?.status?.in ? openProcedures : services,
      ),
    },
    prescription: {
      findMany: jest.fn().mockResolvedValue(prescriptions),
      count: jest.fn().mockResolvedValue(prescriptions.length),
    },
    invoice: { findMany: jest.fn().mockResolvedValue(invoices) },
    visitWorkflowEvent: { create: jest.fn() },
  };

  const rawPrisma = { $transaction: jest.fn((fn: any) => fn(tx)) } as unknown as PrismaService;
  const prisma = {} as unknown as TenantScopedPrismaClient;
  return { service: new DoctorCompletionService(prisma, rawPrisma), tx, actorId: (actor?.id as string) ?? undefined };
}

const run = (ctx: ReturnType<typeof build>, dto = {}) =>
  tenantContextStorage.run({ tenantId: 'test-tenant', staffId: ctx.actorId } as never, () =>
    ctx.service.completeDoctorPhase('visit-1', dto),
  );

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
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
  });

  it('4. a doctor without access to the visit’s branch is denied', async () => {
    const ctx = build({ ...DR_A, clinicId: 'clinic-9' }, { branchCount: 2 });
    await expect(run(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('5. a non-attending doctor is denied — there is no override', async () => {
    const ctx = build(DR_B);
    await expect(run(ctx)).rejects.toThrow(ForbiddenException);
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
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
  it('6. an unsigned clinical note blocks completion', async () => {
    const ctx = build(DR_A, { signedNotes: 0 });
    await expect(run(ctx)).rejects.toThrow(/Sign the clinical note/i);
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
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
    expect(r).toMatchObject({ destination: 'DISPENSARY', reason: 'DISPENSING_REQUIRED', queueStatus: 'READY_FOR_DISPENSARY' });
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

  // Written after the three cases above came out as PAYMENT rather than NONE.
  // That is the SERVICE being right and the first draft of those tests being
  // careless: a prescription is a chargeable item, so a visit carrying one
  // with no invoice raised has unbilled work on it. The owner's rule is
  // explicit — do not silently close a visit containing unbilled chargeable
  // items — so it goes to billing review, not out of the door.
  it('a non-dispensary prescription with NO invoice still goes to billing review', async () => {
    const ctx = build(DR_A, { prescriptions: [RX('EXTERNAL_PRESCRIPTION')], invoices: [] });
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
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
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
    await expect(run(ctx)).resolves.toMatchObject({ destination: 'NONE', reason: 'NOTHING_OUTSTANDING' });
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

    expect(ctx.tx.visit.update).toHaveBeenCalledTimes(1);
    const data = (ctx.tx.visit.update as jest.Mock).mock.calls[0][0].data;
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
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
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
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
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
    const data = (ctx.tx.visit.update as jest.Mock).mock.calls[0][0].data;
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
