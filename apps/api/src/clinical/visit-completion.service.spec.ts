import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { QueueTicketStatus } from '@prisma/client';
import { VisitCompletionService } from './visit-completion.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// G4.5d3c-2b (D-087) — OVERALL VISIT COMPLETION
//
// The ONLY operation that sets Visit.checkOutAt. Everything it checks is
// re-resolved from stored data: a caller cannot assert that dispensing is
// finished or the bill is settled — the service looks.
// ===========================================================================

const OWNER = { id: 'own-1', fullName: 'Owner', role: 'OWNER_ADMIN', active: true, clinicId: 'clinic-1', userId: 'u1' };
const FRONT_DESK = { id: 'fd-1', fullName: 'Amy', role: 'FRONT_DESK_CLINICAL_STAFF', active: true, clinicId: 'clinic-1', userId: 'u2' };
const FINANCE = { id: 'fin-1', fullName: 'Faiz', role: 'FINANCE_STAFF', active: true, clinicId: 'clinic-1', userId: 'u3' };
const DOCTOR = { id: 'dr-a', fullName: 'Dr Amira', role: 'DOCTOR_RESIDENT', active: true, clinicId: 'clinic-1', userId: 'u4' };
const STOCK = { id: 'st-1', fullName: 'Sam', role: 'STOCK_STAFF', active: true, clinicId: 'clinic-1', userId: 'u5' };

const DONE = new Date('2026-08-04T08:00:00Z');

/**
 * A fixed consultation start: 10:00 on a Tuesday, Asia/Kuala_Lumpur.
 * Every tariff assertion in this file is relative to this instant, so none of
 * them depends on when the suite happens to run.
 */
const CONSULTATION_AT = new Date('2026-08-04T02:00:00Z');

interface World {
  visit?: Record<string, unknown> | null;
  ticketStatus?: QueueTicketStatus | null;
  openProcedures?: number;
  prescriptions?: Array<{ supplyMode: string | null; status: string }>;
  invoices?: Array<{ patientResponsibilityAmount: number | null; patientPaidAmount: number }>;
  services?: number;
  branchCount?: number;
  claimCount?: number;
  /** D-094 — active consultation tariff rules ([] = the feature is off). */
  tariffRules?: Array<Record<string, unknown>>;
  /** G4.5d6 — DRAFT notes on the visit, which completion finalizes. */
  draftNotes?: Array<Record<string, unknown>>;
  /**
   * G4.5d3c-3c — how many SIGNED doctor narratives the visit has. The default
   * is 1, i.e. documentation complete: the note-signature requirement moved
   * here from doctor-phase routing, so every pre-existing test in this file
   * is about a visit whose record is already written.
   */
  signedNotes?: number;
}

function build(actor: Record<string, unknown> | null, world: World = {}) {
  const {
    visit = { id: 'visit-1', clinicId: 'clinic-1', checkOutAt: null, doctorCompletedAt: DONE },
    ticketStatus = QueueTicketStatus.READY_FOR_PAYMENT,
    openProcedures = 0,
    prescriptions = [],
    // Default: one fully resolved, fully covered invoice — nothing outstanding.
    invoices = [{ patientResponsibilityAmount: 0, patientPaidAmount: 0 }],
    services = 0,
    branchCount = 1,
    claimCount = 1,
    tariffRules = [],
    signedNotes = 1,
    // G4.5d6 — open drafts the completion transaction should finalize. The
    // default is one properly attributed draft, because that is the ordinary
    // visit now: the doctor wrote the note and never pressed anything.
    draftNotes = [
      {
        id: 'note-1',
        authorStaffId: 'staff-doc',
        authorNameSnapshot: 'Dr Amira Rahman',
        authorRoleSnapshot: 'DOCTOR_RESIDENT',
      },
    ],
  } = world;

  const finalizedNotes: Array<Record<string, any>> = [];
  const tx = {
    $executeRaw: jest.fn(),
    staff: { findUnique: jest.fn(async ({ where }: any) => (actor && where.id === actor.id ? actor : null)) },
    clinic: { count: jest.fn().mockResolvedValue(branchCount) },
    userClinicAccess: { findMany: jest.fn().mockResolvedValue([]) },
    visit: {
      findUnique: jest.fn(async ({ select }: any) => {
        // D-094's tariff resolution asks for the consultation's start time.
        // It must be a FIXED instant: the fallback chain ends at the visit's
        // check-in, and a fixture that supplies none silently formats the
        // current wall clock instead — which made these assertions pass by
        // day and fail between 23:00 and 08:00 clinic time. Found while
        // adding the 3c documentation blocker; the fixture was always wrong.
        if (select?.checkInAt) {
          return {
            clinicId: 'clinic-1',
            checkInAt: CONSULTATION_AT,
            clinic: { timezone: 'Asia/Kuala_Lumpur' },
            queueTicket: { status: ticketStatus, calledAt: CONSULTATION_AT },
          };
        }
        return select?.clinicId && !select?.checkOutAt ? { clinicId: 'clinic-1' } : visit;
      }),
      updateMany: jest.fn().mockResolvedValue({ count: claimCount }),
    },
    queueTicket: {
      findUnique: jest.fn().mockResolvedValue(ticketStatus === null ? null : { id: 't1', status: ticketStatus }),
      update: jest.fn(),
    },
    orderService: {
      count: jest.fn(async ({ where }: any) => (where?.status?.in ? openProcedures : services)),
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
      findMany: jest.fn(async () => prescriptions.map((p, i) => ({ id: `rx-${i}`, quantity: 1, item: null, ...p }))),
      count: jest.fn().mockResolvedValue(prescriptions.length),
    },
    invoice: { findMany: jest.fn().mockResolvedValue(invoices) },
    invoiceLine: { findMany: jest.fn().mockResolvedValue([]) },
    // D-094 — the worklist resolves the consultation charge too. No tariff
    // configured (the default) = consultation auto-billing off for the clinic.
    consultationTariffRule: { findMany: jest.fn(async () => tariffRules) },
    // G4.5d3c-3c — the clinical documentation check.
    // G4.5d6 — completion now FINALIZES the visit's open drafts inside the
    // same transaction, so the harness has to model them. `finalizedNotes`
    // records what the service locked, which is what the new tests assert on.
    clinicalNote: {
      count: jest.fn().mockResolvedValue(signedNotes),
      findMany: jest.fn(async () => draftNotes),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const draft = draftNotes.find((n: any) => n.id === where.id);
        if (!draft) return { count: 0 };
        finalizedNotes.push({ id: where.id, ...data });
        return { count: 1 };
      }),
    },
    visitWorkflowEvent: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
  };

  const rawPrisma = { $transaction: jest.fn((fn: any) => fn(tx)) } as unknown as PrismaService;
  return {
    service: new VisitCompletionService({} as unknown as TenantScopedPrismaClient, rawPrisma),
    tx,
    /** What completion actually locked, for the finalization assertions. */
    finalizedNotes,
    actorId: (actor?.id as string) ?? undefined,
  };
}

const run = (ctx: ReturnType<typeof build>, dto = {}) =>
  tenantContextStorage.run({ tenantId: 'test-tenant', staffId: ctx.actorId } as never, () =>
    ctx.service.completeVisit('visit-1', dto),
  );

const codes = async (ctx: ReturnType<typeof build>) => {
  const error = (await run(ctx).catch((e) => e)) as { response?: { blockers?: Array<{ code: string }> } };
  return (error.response?.blockers ?? []).map((b) => b.code);
};

const RX = (supplyMode: string | null, status = 'ORDERED') => ({ supplyMode, status });

describe('authorisation', () => {
  it('12. anonymous completion is denied', async () => {
    await expect(run(build(null))).rejects.toThrow(ForbiddenException);
  });

  it.each([
    ['13. a doctor', DOCTOR],
    ['stock staff', STOCK],
    // TASK 1, owner decision 1 — the INTENTIONAL narrowing. Closing a visit
    // asserts that dispensing and payment are done, which is a counter fact,
    // not a finance one. Finance keeps every billing action it had.
    ['15. finance, which held this before', FINANCE],
  ])('%s cannot complete a visit', async (_n, actor) => {
    const ctx = build(actor);
    await expect(run(ctx)).rejects.toThrow(ForbiddenException);
    expect(ctx.tx.visit.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['14. front desk', FRONT_DESK],
    ['16. owner', OWNER],
  ])('%s may complete an eligible visit', async (_n, actor) => {
    await expect(run(build(actor))).resolves.toMatchObject({ alreadyCompleted: false });
  });

  it('18. a doctor’s branch restriction still applies to the counter too', async () => {
    const ctx = build({ ...FRONT_DESK, clinicId: 'clinic-9' }, { branchCount: 2 });
    await expect(run(ctx)).rejects.toThrow(ForbiddenException);
  });
});

describe('preconditions', () => {
  // G4.5d6 — DOCUMENTATION NO LONGER BLOCKS. It is finalized instead.
  //
  // The five tests these replace pinned the opposite rule, and they were
  // right for the workflow that existed: a visit could not close without a
  // signed note. What changed is not the standard of the record but where it
  // is enforced — the note is now locked automatically, immutably and with
  // full attribution at the moment the visit closes, so nothing is unwritten
  // and nobody waits at a counter for a doctor to press a button.

  it('3c-1. an unsigned clinical note does NOT block visit completion', async () => {
    const ctx = build(FRONT_DESK, { signedNotes: 0 });
    await expect(run(ctx)).resolves.toMatchObject({ alreadyCompleted: false });
    expect(await codes(build(FRONT_DESK, { signedNotes: 0 }))).not.toContain(
      'CLINICAL_DOCUMENTATION_PENDING',
    );
  });

  it('3c-2. completion FINALIZES the open draft, in the same transaction', async () => {
    const ctx = build(FRONT_DESK, { signedNotes: 0 });
    await run(ctx);
    expect(ctx.finalizedNotes).toHaveLength(1);
    expect(ctx.finalizedNotes[0]).toMatchObject({
      id: 'note-1',
      status: 'SIGNED',
      finalizationMode: 'AUTO_ON_VISIT_COMPLETION',
    });
    expect(ctx.finalizedNotes[0].finalizedAt).toBeInstanceOf(Date);
  });

  it('3c-3. the finalized note keeps its AUTHOR, and records who closed the visit', async () => {
    // The words are the clinician's. Attributing them to whoever happened to
    // close the visit at the counter would be a falsification; who finalized
    // it is recorded separately.
    const ctx = build(FRONT_DESK, { signedNotes: 0 });
    await run(ctx);
    expect(ctx.finalizedNotes[0]).toMatchObject({
      signedByStaffId: 'staff-doc',
      signerNameSnapshot: 'Dr Amira Rahman',
      signerRoleSnapshot: 'DOCTOR_RESIDENT',
      finalizedByStaffId: FRONT_DESK.id,
    });
  });

  it('3c-4. an unattributed draft is left alone rather than signed by nobody', async () => {
    // The signature-state constraint needs a full identity. Inventing one to
    // satisfy it would be the same falsification by another route.
    const ctx = build(FRONT_DESK, {
      signedNotes: 0,
      draftNotes: [{ id: 'note-orphan', authorStaffId: null, authorNameSnapshot: null, authorRoleSnapshot: null }],
    });
    await expect(run(ctx)).resolves.toMatchObject({ alreadyCompleted: false });
    expect(ctx.finalizedNotes).toHaveLength(0);
  });

  it('3c-5. finalization is an atomic claim — a draft cannot be finalized twice', async () => {
    const ctx = build(FRONT_DESK, { signedNotes: 0 });
    await run(ctx);
    const claim = ctx.tx.clinicalNote.updateMany.mock.calls[0][0];
    // The precondition is in the WHERE clause, exactly like every other
    // claim in this service.
    expect(claim.where).toMatchObject({ id: 'note-1', status: 'DRAFT' });
  });

  it('3c-6. a visit with no open draft completes and finalizes nothing', async () => {
    const ctx = build(FRONT_DESK, { draftNotes: [] });
    await expect(run(ctx)).resolves.toMatchObject({ alreadyCompleted: false });
    expect(ctx.finalizedNotes).toHaveLength(0);
  });

  it('19. an incomplete doctor phase blocks', async () => {
    const ctx = build(FRONT_DESK, { visit: { id: 'visit-1', clinicId: 'clinic-1', checkOutAt: null, doctorCompletedAt: null } });
    expect(await codes(ctx)).toContain('DOCTOR_PHASE_NOT_COMPLETED');
  });

  it.each([
    ['20. PENDING', 1],
    ['21. IN_PROGRESS', 1],
  ])('%s procedure blocks', async (_n, open) => {
    const ctx = build(FRONT_DESK, { openProcedures: open });
    expect(await codes(ctx)).toContain('PROCEDURE_PENDING');
  });

  it('22. an ONSITE_DISPENSE item still ORDERED blocks', async () => {
    const ctx = build(FRONT_DESK, { prescriptions: [RX('ONSITE_DISPENSE')] });
    expect(await codes(ctx)).toContain('DISPENSING_PENDING');
  });

  it('23. a DISPENSED onsite item does not block — once it is billed', async () => {
    // D-093: the dispensed medication must also be ON the invoice. An
    // invoice that misses it now blocks as unbilled work (owner test 26),
    // so this world bills it explicitly.
    const ctx = build(FRONT_DESK, { prescriptions: [RX('ONSITE_DISPENSE', 'DISPENSED')] });
    ctx.tx.invoiceLine.findMany.mockResolvedValue([
      { id: 'l1', sourcePrescriptionId: 'rx-0', sourceOrderServiceId: null },
    ]);
    await expect(run(ctx)).resolves.toMatchObject({ alreadyCompleted: false });
  });

  it('26. an existing invoice does NOT hide an unbilled dispensed medication', async () => {
    const ctx = build(FRONT_DESK, { prescriptions: [RX('ONSITE_DISPENSE', 'DISPENSED')] });
    // Default world: a resolved invoice exists, but no line bills rx-0.
    await expect(run(ctx)).rejects.toMatchObject({
      response: { blockers: expect.arrayContaining([expect.objectContaining({ code: 'UNBILLED_CHARGEABLE_ITEMS' })]) },
    });
  });

  it('27/28/29. external, own-supply and no-supply medications are never unbilled work', async () => {
    for (const mode of ['EXTERNAL_PRESCRIPTION', 'PATIENT_OWN_SUPPLY', 'NO_SUPPLY_REQUIRED']) {
      const ctx = build(FRONT_DESK, { prescriptions: [RX(mode, 'ORDERED')] });
      await expect(run(ctx)).resolves.toMatchObject({ alreadyCompleted: false });
    }
  });

  it('25. DEFERRED blocks', async () => {
    const ctx = build(FRONT_DESK, { prescriptions: [RX('DEFERRED')] });
    expect(await codes(ctx)).toContain('MEDICATION_SUPPLY_DEFERRED');
  });

  it('26. a NULL supply mode blocks', async () => {
    const ctx = build(FRONT_DESK, { prescriptions: [RX(null)] });
    expect(await codes(ctx)).toContain('MEDICATION_SUPPLY_UNCONFIRMED');
  });

  it('27. a NULL patient responsibility blocks', async () => {
    const ctx = build(FRONT_DESK, { invoices: [{ patientResponsibilityAmount: null, patientPaidAmount: 0 }] });
    expect(await codes(ctx)).toContain('BILLING_REVIEW_REQUIRED');
  });

  it('28. a remaining patient balance blocks', async () => {
    const ctx = build(FRONT_DESK, { invoices: [{ patientResponsibilityAmount: 85, patientPaidAmount: 0 }] });
    expect(await codes(ctx)).toContain('PATIENT_BALANCE_REMAINING');
  });

  it('29. a fully panel-covered resolved invoice does not block', async () => {
    const ctx = build(FRONT_DESK, { invoices: [{ patientResponsibilityAmount: 0, patientPaidAmount: 0 }] });
    await expect(run(ctx)).resolves.toMatchObject({ alreadyCompleted: false });
  });

  it('31. an unbilled chargeable item blocks', async () => {
    const ctx = build(FRONT_DESK, { invoices: [], services: 2 });
    expect(await codes(ctx)).toContain('UNBILLED_CHARGEABLE_ITEMS');
  });

  it('nothing chargeable and no invoice does not block', async () => {
    const ctx = build(FRONT_DESK, { invoices: [], services: 0 });
    await expect(run(ctx)).resolves.toMatchObject({ alreadyCompleted: false });
  });

  // G4.5d3c-3b2 (D-094) — the consultation blockers.
  const DAY_RULE = {
    id: 'rule-day',
    classification: 'CONSULTATION',
    startTime: '08:00',
    endTime: '22:59',
    effectiveFrom: null,
    effectiveTo: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    serviceCatalog: { id: 'svc-consult', name: 'Consultation (Day)', active: true },
  };

  it('a matched-but-uninvoiced consultation is unbilled chargeable work', async () => {
    const ctx = build(FRONT_DESK, { tariffRules: [DAY_RULE] });
    expect(await codes(ctx)).toContain('UNBILLED_CHARGEABLE_ITEMS');
  });

  it('a consultation the tariff cannot resolve raises its own review blocker', async () => {
    // Configured, but no band covers the consultation start: a human must
    // look. Never a guessed price, and never silently completable.
    const ctx = build(FRONT_DESK, { tariffRules: [{ ...DAY_RULE, startTime: '08:00', endTime: '09:00' }] });
    ctx.tx.visitWorkflowEvent.findFirst.mockResolvedValue({ createdAt: new Date('2026-08-04T14:00:00Z') }); // 22:00 KL
    expect(await codes(ctx)).toContain('CONSULTATION_TARIFF_REVIEW_REQUIRED');
  });

  it('a clinic with no configured tariff is unaffected — consultation billing is off', async () => {
    const ctx = build(FRONT_DESK, { tariffRules: [] });
    await expect(run(ctx)).resolves.toMatchObject({ alreadyCompleted: false });
  });

  it('an ineligible queue state blocks', async () => {
    const ctx = build(FRONT_DESK, { ticketStatus: QueueTicketStatus.WAITING });
    expect(await codes(ctx)).toContain('QUEUE_STATE_INELIGIBLE');
  });

  it('40. a cancelled visit cannot be completed', async () => {
    const ctx = build(FRONT_DESK, { ticketStatus: QueueTicketStatus.CANCELLED });
    await expect(run(ctx)).rejects.toThrow(/cancelled/i);
    expect(ctx.tx.visit.updateMany).not.toHaveBeenCalled();
  });

  it('ALL blockers are reported at once, not one refresh at a time', async () => {
    const ctx = build(FRONT_DESK, {
      visit: { id: 'visit-1', clinicId: 'clinic-1', checkOutAt: null, doctorCompletedAt: null },
      openProcedures: 1,
      prescriptions: [RX('DEFERRED')],
      invoices: [{ patientResponsibilityAmount: null, patientPaidAmount: 0 }],
    });
    const found = await codes(ctx);
    expect(found).toEqual(
      expect.arrayContaining([
        'DOCTOR_PHASE_NOT_COMPLETED',
        'PROCEDURE_PENDING',
        'MEDICATION_SUPPLY_DEFERRED',
        'BILLING_REVIEW_REQUIRED',
      ]),
    );
  });

  it('no blocker message exposes implementation vocabulary', async () => {
    const ctx = build(FRONT_DESK, { prescriptions: [RX(null)], openProcedures: 1 });
    const error = (await run(ctx).catch((e) => e)) as { response: { blockers: Array<{ message: string }> } };
    const banned = /prisma|sql|enum|constraint|ONSITE_DISPENSE|supplyMode|checkOutAt|null/i;
    for (const b of error.response.blockers) {
      expect(b.message).not.toMatch(banned);
    }
  });
});

describe('destination-specific completion', () => {
  it('33. DISPENSARY completes once dispensing and billing are resolved', async () => {
    const ctx = build(FRONT_DESK, {
      ticketStatus: QueueTicketStatus.READY_FOR_DISPENSARY,
      prescriptions: [RX('ONSITE_DISPENSE', 'DISPENSED')],
      invoices: [{ patientResponsibilityAmount: 0, patientPaidAmount: 0 }],
    });
    ctx.tx.invoiceLine.findMany.mockResolvedValue([
      { id: 'l1', sourcePrescriptionId: 'rx-0', sourceOrderServiceId: null },
    ]);
    await expect(run(ctx)).resolves.toMatchObject({ queueStatus: 'COMPLETED' });
  });

  it('34. PAYMENT completes once the balance is zero', async () => {
    const ctx = build(FRONT_DESK, {
      ticketStatus: QueueTicketStatus.READY_FOR_PAYMENT,
      invoices: [{ patientResponsibilityAmount: 85, patientPaidAmount: 85 }],
    });
    await expect(run(ctx)).resolves.toMatchObject({ queueStatus: 'COMPLETED' });
  });

  it('32. NONE completes from IN_CONSULTATION', async () => {
    const ctx = build(FRONT_DESK, { ticketStatus: QueueTicketStatus.IN_CONSULTATION });
    await expect(run(ctx)).resolves.toMatchObject({ queueStatus: 'COMPLETED' });
  });
});

describe('atomicity, idempotency and concurrency', () => {
  it('35/36. one transaction sets checkOutAt, the queue status and ONE event', async () => {
    const ctx = build(FRONT_DESK);
    await run(ctx, { correlationId: 'corr-v1' });

    expect(ctx.tx.visit.updateMany).toHaveBeenCalledWith({
      where: { id: 'visit-1', checkOutAt: null },
      data: { checkOutAt: expect.any(Date) },
    });
    expect(ctx.tx.queueTicket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: 'COMPLETED' },
    });
    expect(ctx.tx.visitWorkflowEvent.create).toHaveBeenCalledTimes(1);
    expect(ctx.tx.visitWorkflowEvent.create.mock.calls[0][0].data).toMatchObject({
      eventType: 'VISIT_COMPLETED',
      newStatus: 'COMPLETED',
      actorStaffId: FRONT_DESK.id,
      correlationId: 'corr-v1',
    });
  });

  it('37. a failed event insert rolls everything back', async () => {
    const ctx = build(FRONT_DESK);
    ctx.tx.visitWorkflowEvent.create.mockRejectedValue(new Error('disk full'));
    await expect(run(ctx)).rejects.toThrow();
  });

  it('38. a repeat preserves the ORIGINAL checkOutAt', async () => {
    const original = new Date('2026-08-04T10:30:00Z');
    const ctx = build(FRONT_DESK, {
      visit: { id: 'visit-1', clinicId: 'clinic-1', checkOutAt: original, doctorCompletedAt: DONE },
      ticketStatus: QueueTicketStatus.COMPLETED,
    });

    const r = await run(ctx);

    // Rewriting it would move the clinic's record of when the patient left.
    expect(r).toMatchObject({ checkOutAt: original, alreadyCompleted: true });
    expect(ctx.tx.visit.updateMany).not.toHaveBeenCalled();
    expect(ctx.tx.visitWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it('39. the loser of a concurrent race returns the committed result, not an error', async () => {
    // claimCount 0 = another request won the atomic UPDATE ... WHERE
    // checkOutAt IS NULL between this one's read and its write.
    const winner = new Date('2026-08-04T11:00:00Z');
    const ctx = build(FRONT_DESK, { claimCount: 0 });
    ctx.tx.visit.findUnique
      .mockResolvedValueOnce({ clinicId: 'clinic-1' })
      .mockResolvedValueOnce({ id: 'visit-1', clinicId: 'clinic-1', checkOutAt: null, doctorCompletedAt: DONE })
      .mockResolvedValue({ checkOutAt: winner });

    const r = await run(ctx);

    expect(r).toMatchObject({ checkOutAt: winner, alreadyCompleted: true });
    // Only ONE completion event exists, and it belongs to the winner.
    expect(ctx.tx.visitWorkflowEvent.create).not.toHaveBeenCalled();
    expect(ctx.tx.queueTicket.update).not.toHaveBeenCalled();
  });

  it('the caller cannot supply checkOutAt', async () => {
    const ctx = build(FRONT_DESK);
    await run(ctx, { checkOutAt: new Date('2020-01-01') } as never);
    const written = (ctx.tx.visit.updateMany as jest.Mock).mock.calls[0][0].data.checkOutAt as Date;
    expect(written.getUTCFullYear()).toBeGreaterThan(2020);
  });
});
