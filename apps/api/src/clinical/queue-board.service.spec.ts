import { QueueBoardService } from './queue-board.service';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// G4.5d3c-3b (D-095) — THE QUEUE BOARD.
//
// What is pinned here: every status reaches a stage (nothing vanishes),
// cancelled work is never counted as active, dispensing progress counts only
// clinic-dispensed medication, an unresolved responsibility is reported as
// unresolved rather than as a zero balance, a panel receivable never holds a
// visit open, and completion eligibility is the SERVER'S — decided from the
// authoritative blocker evaluator, never from which tab a row sits in.
// ===========================================================================

const FRONT_DESK = {
  id: 'staff-1', fullName: 'Siti Counter', role: 'FRONT_DESK_CLINICAL_STAFF',
  active: true, clinicId: 'clinic-1', userId: 'user-1',
};

interface Ticket {
  id: string;
  visitId: string;
  status: string;
  displayNumber?: string | null;
  doctorCompletedAt?: Date | null;
  checkOutAt?: Date | null;
}

interface World {
  tickets?: Ticket[];
  prescriptions?: Array<Record<string, unknown>>;
  invoices?: Array<Record<string, unknown>>;
  orderServicesOpen?: number;
  worklistPrescriptions?: Array<Record<string, unknown>>;
  worklistOrders?: Array<Record<string, unknown>>;
  actor?: Record<string, unknown> | null;
  branchCount?: number;
}

function build(world: World = {}) {
  const {
    tickets = [],
    prescriptions = [],
    invoices = [],
    orderServicesOpen = 0,
    worklistPrescriptions = [],
    worklistOrders = [],
    actor = FRONT_DESK,
    branchCount = 1,
  } = world;

  const tx = {
    $executeRaw: jest.fn(),
    staff: { findUnique: jest.fn(async () => actor) },
    clinic: { count: jest.fn().mockResolvedValue(branchCount) },
    userClinicAccess: { findMany: jest.fn().mockResolvedValue([]) },
    queueTicket: {
      findMany: jest.fn(async () =>
        tickets.map((t) => ({
          id: t.id,
          visitId: t.visitId,
          displayNumber: t.displayNumber ?? 'W001',
          queueType: 'WALK_IN',
          status: t.status,
          calledAt: null,
          room: { name: 'Consultation 1' },
          visit: {
            id: t.visitId,
            checkInAt: new Date('2026-08-04T02:00:00Z'),
            checkOutAt: t.checkOutAt ?? null,
            doctorCompletedAt:
              'doctorCompletedAt' in t ? t.doctorCompletedAt : new Date('2026-08-04T02:30:00Z'),
            billingType: 'Self-pay',
            patient: { id: `p-${t.visitId}`, name: `Patient ${t.visitId}` },
            staff: { fullName: 'Dr Amira' },
            panelClinic: null,
          },
        })),
      ),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    // Serves BOTH the dispensing summary (supplyMode filter) and the blocker
    // evaluator's supply scan, and the worklist.
    prescription: {
      findMany: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        where?.supplyMode === 'ONSITE_DISPENSE' ? prescriptions : worklistPrescriptions,
      ),
    },
    orderService: {
      count: jest.fn(async () => orderServicesOpen),
      findMany: jest.fn(async () => worklistOrders),
    },
    invoice: { findMany: jest.fn(async () => invoices) },
    invoiceLine: { findMany: jest.fn(async () => []) },
    visit: { findUnique: jest.fn().mockResolvedValue(null) },
    consultationTariffRule: { findMany: jest.fn().mockResolvedValue([]) },
    visitWorkflowEvent: { findFirst: jest.fn().mockResolvedValue(null) },
    // G4.5d3c-3c — the board evaluates the same blockers the completion
    // endpoint does, which now includes the clinical-documentation check. The
    // default is a signed note: these tests are about queue stages, dispensing
    // and money, and an unsigned note would add a blocker to every row.
    clinicalNote: { count: jest.fn().mockResolvedValue(1) },
  };
  const rawPrisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;
  return { service: new QueueBoardService(rawPrisma), tx };
}

const withTenant = <T,>(fn: () => Promise<T>) =>
  tenantContextStorage.run({ tenantId: 'test-tenant', staffId: 'staff-1' }, fn);

const RESOLVED_INVOICE = {
  id: 'inv-1', invoiceNumber: 'INV-000001', totalAmount: 100,
  panelResponsibilityAmount: 0, patientResponsibilityAmount: 100, patientPaidAmount: 100,
};

describe('queue board — stages and counts', () => {
  it('1–6/11. every live status lands in a stage; nothing disappears', async () => {
    const { service } = build({
      tickets: [
        { id: 't1', visitId: 'v1', status: 'WAITING' },
        { id: 't2', visitId: 'v2', status: 'IN_CONSULTATION' },
        { id: 't3', visitId: 'v3', status: 'AT_PROCEDURE' },
        { id: 't4', visitId: 'v4', status: 'READY_FOR_DISPENSARY' },
        { id: 't5', visitId: 'v5', status: 'READY_FOR_PAYMENT' },
        { id: 't6', visitId: 'v6', status: 'COMPLETED', checkOutAt: new Date() },
      ],
    });
    const board = await withTenant(() => service.board('clinic-1'));
    expect(board.rows.map((r) => r.stage)).toEqual([
      'WAITING', 'CONSULTATION', 'CONSULTATION', 'DISPENSARY', 'PAYMENT', 'COMPLETED',
    ]);
    expect(board.counts).toMatchObject({
      totalToday: 6, waiting: 1, consultation: 2, dispensary: 1, payment: 1, completed: 1, cancelled: 0,
    });
  });

  it('3. AT_PROCEDURE sits under Consultation and is flagged', async () => {
    const { service } = build({ tickets: [{ id: 't1', visitId: 'v1', status: 'AT_PROCEDURE' }] });
    const board = await withTenant(() => service.board('clinic-1'));
    expect(board.rows[0]).toMatchObject({ stage: 'CONSULTATION', atProcedure: true });
  });

  it('7. CANCELLED is excluded from active counts and never completable', async () => {
    const { service } = build({
      tickets: [
        { id: 't1', visitId: 'v1', status: 'WAITING' },
        { id: 't2', visitId: 'v2', status: 'CANCELLED' },
      ],
    });
    const board = await withTenant(() => service.board('clinic-1'));
    expect(board.counts.totalToday).toBe(1);
    expect(board.counts.cancelled).toBe(1);
    expect(board.rows.find((r) => r.status === 'CANCELLED')).toMatchObject({ stage: null, canComplete: false });
  });

  it('8. a legacy DISPENSARY_PAYMENT row is flagged and shown under Payment', async () => {
    const { service } = build({ tickets: [{ id: 't1', visitId: 'v1', status: 'DISPENSARY_PAYMENT' }] });
    const board = await withTenant(() => service.board('clinic-1'));
    expect(board.rows[0]).toMatchObject({ stage: 'PAYMENT', legacyStatus: true });
  });
});

describe('queue board — dispensing progress', () => {
  it('counts only clinic-dispensed medication, and reports what remains', async () => {
    const { service } = build({
      tickets: [{ id: 't1', visitId: 'v1', status: 'READY_FOR_DISPENSARY' }],
      prescriptions: [{ status: 'DISPENSED' }, { status: 'DISPENSED' }, { status: 'ORDERED' }],
    });
    const board = await withTenant(() => service.board('clinic-1'));
    expect(board.rows[0].dispensing).toEqual({ onsiteTotal: 3, dispensed: 2, remaining: 1 });
  });

  it('a visit with no clinic-dispensed medication reports zero, not "unknown"', async () => {
    const { service } = build({ tickets: [{ id: 't1', visitId: 'v1', status: 'READY_FOR_PAYMENT' }] });
    const board = await withTenant(() => service.board('clinic-1'));
    expect(board.rows[0].dispensing).toEqual({ onsiteTotal: 0, dispensed: 0, remaining: 0 });
  });

  it('the query asks only for ONSITE_DISPENSE — an external script is not dispensary work', async () => {
    const { service, tx } = build({ tickets: [{ id: 't1', visitId: 'v1', status: 'READY_FOR_DISPENSARY' }] });
    await withTenant(() => service.board('clinic-1'));
    const call = tx.prescription.findMany.mock.calls.find(
      (c) => (c[0] as { where?: Record<string, unknown> })?.where?.supplyMode === 'ONSITE_DISPENSE',
    );
    expect(call).toBeDefined();
  });
});

describe('queue board — billing state', () => {
  it('no invoice reads NO_INVOICE, with no invented amounts', async () => {
    const { service } = build({ tickets: [{ id: 't1', visitId: 'v1', status: 'READY_FOR_PAYMENT' }] });
    const board = await withTenant(() => service.board('clinic-1'));
    expect(board.rows[0].billing).toMatchObject({
      state: 'NO_INVOICE', grandTotal: null, patientResponsibility: null, remainingBalance: null,
    });
  });

  it('an unresolved responsibility reads UNRESOLVED, never a zero balance', async () => {
    const { service } = build({
      tickets: [{ id: 't1', visitId: 'v1', status: 'READY_FOR_PAYMENT' }],
      invoices: [{ ...RESOLVED_INVOICE, patientResponsibilityAmount: null, panelResponsibilityAmount: null }],
    });
    const board = await withTenant(() => service.board('clinic-1'));
    expect(board.rows[0].billing).toMatchObject({
      state: 'UNRESOLVED', grandTotal: '100.00', patientResponsibility: null, remainingBalance: null,
    });
  });

  it('31. an outstanding balance is reported with its exact amount', async () => {
    const { service } = build({
      tickets: [{ id: 't1', visitId: 'v1', status: 'READY_FOR_PAYMENT' }],
      invoices: [{ ...RESOLVED_INVOICE, patientResponsibilityAmount: 123.45, patientPaidAmount: 0 }],
    });
    const board = await withTenant(() => service.board('clinic-1'));
    expect(board.rows[0].billing).toMatchObject({ state: 'BALANCE_DUE', remainingBalance: '123.45' });
  });

  it('16. a panel-covered visit is SETTLED once the PATIENT owes nothing', async () => {
    // The panel receivable is Finance's business and never holds a visit open.
    const { service } = build({
      tickets: [{ id: 't1', visitId: 'v1', status: 'READY_FOR_PAYMENT' }],
      invoices: [{
        ...RESOLVED_INVOICE, totalAmount: 250,
        panelResponsibilityAmount: 250, patientResponsibilityAmount: 0, patientPaidAmount: 0,
      }],
    });
    const board = await withTenant(() => service.board('clinic-1'));
    expect(board.rows[0].billing).toMatchObject({
      state: 'SETTLED', panelResponsibility: '250.00', patientResponsibility: '0.00', remainingBalance: '0.00',
    });
    expect(board.rows[0].canComplete).toBe(true);
  });
});

describe('queue board — completion eligibility is the SERVER’S', () => {
  it('47. an eligible payment-stage visit is completable', async () => {
    const { service } = build({
      tickets: [{ id: 't1', visitId: 'v1', status: 'READY_FOR_PAYMENT' }],
      invoices: [RESOLVED_INVOICE],
    });
    const board = await withTenant(() => service.board('clinic-1'));
    expect(board.rows[0]).toMatchObject({ canComplete: true, blockers: [] });
  });

  // 28 in particular: there is deliberately NO owner override for incomplete
  // dispensing. Medication that has not been supplied cannot be closed over.
  it.each(['FRONT_DESK_CLINICAL_STAFF', 'OWNER_ADMIN'])(
    '27/28. a dispensing blocker refuses completion for %s',
    async (role) => {
      const { service } = build({
        tickets: [{ id: 't1', visitId: 'v1', status: 'READY_FOR_DISPENSARY' }],
        actor: { ...FRONT_DESK, role },
        prescriptions: [{ status: 'ORDERED' }],
        worklistPrescriptions: [
          { id: 'rx-1', quantity: 2, supplyMode: 'ONSITE_DISPENSE', status: 'ORDERED', item: { name: 'Amoxicillin' } },
        ],
      });
      const board = await withTenant(() => service.board('clinic-1'));
      expect(board.rows[0].canComplete).toBe(false);
      expect(board.rows[0].blockers?.map((b) => b.code)).toContain('DISPENSING_PENDING');
    },
  );

  it('30. an outstanding patient balance refuses completion', async () => {
    const { service } = build({
      tickets: [{ id: 't1', visitId: 'v1', status: 'READY_FOR_PAYMENT' }],
      invoices: [{ ...RESOLVED_INVOICE, patientPaidAmount: 0 }],
    });
    const board = await withTenant(() => service.board('clinic-1'));
    expect(board.rows[0].canComplete).toBe(false);
    expect(board.rows[0].blockers?.map((b) => b.code)).toContain('PATIENT_BALANCE_REMAINING');
  });

  it('23. an unfinished doctor phase refuses completion', async () => {
    const { service } = build({
      tickets: [{ id: 't1', visitId: 'v1', status: 'IN_CONSULTATION', doctorCompletedAt: null }],
    });
    const board = await withTenant(() => service.board('clinic-1'));
    expect(board.rows[0].blockers?.map((b) => b.code)).toContain('DOCTOR_PHASE_NOT_COMPLETED');
    expect(board.rows[0].canComplete).toBe(false);
  });

  it('34. a WAITING visit is not evaluated and is never offered completion', async () => {
    const { service } = build({ tickets: [{ id: 't1', visitId: 'v1', status: 'WAITING' }] });
    const board = await withTenant(() => service.board('clinic-1'));
    expect(board.rows[0]).toMatchObject({ blockers: null, canComplete: false });
  });

  it('an already-completed visit is never offered completion again', async () => {
    const { service } = build({
      tickets: [{ id: 't1', visitId: 'v1', status: 'COMPLETED', checkOutAt: new Date() }],
      invoices: [RESOLVED_INVOICE],
    });
    const board = await withTenant(() => service.board('clinic-1'));
    expect(board.rows[0].canComplete).toBe(false);
  });

  it.each([
    ['17. OWNER_ADMIN', 'OWNER_ADMIN', true],
    ['18. FRONT_DESK_CLINICAL_STAFF', 'FRONT_DESK_CLINICAL_STAFF', true],
    // TASK 1 — finance loses visit completion, and the board says so with the
    // same function the server refuses with. No button is offered that the
    // server would then reject.
    ['19. FINANCE_STAFF', 'FINANCE_STAFF', false],
    ['20. DOCTOR_RESIDENT', 'DOCTOR_RESIDENT', false],
    ['20. DOCTOR_LOCUM', 'DOCTOR_LOCUM', false],
    ['STOCK_STAFF', 'STOCK_STAFF', false],
  ])('%s completion permission is %s', async (_n, role, permitted) => {
    const { service } = build({
      tickets: [{ id: 't1', visitId: 'v1', status: 'READY_FOR_PAYMENT' }],
      invoices: [RESOLVED_INVOICE],
      actor: { ...FRONT_DESK, role },
    });
    const board = await withTenant(() => service.board('clinic-1'));
    expect(board.mayCompleteVisits).toBe(permitted);
    expect(board.rows[0].canComplete).toBe(permitted);
  });

  it('an inactive staff member cannot even read the board', async () => {
    // requireActor refuses before any board is built — stronger than hiding
    // the button, and the reason this assertion states a refusal.
    const { service } = build({
      tickets: [{ id: 't1', visitId: 'v1', status: 'READY_FOR_PAYMENT' }],
      invoices: [RESOLVED_INVOICE],
      actor: { ...FRONT_DESK, active: false },
    });
    await expect(withTenant(() => service.board('clinic-1'))).rejects.toThrow(/inactive/i);
  });

  it('22. a branch the actor is not authorised for returns an empty board', async () => {
    const { service } = build({
      tickets: [{ id: 't1', visitId: 'v1', status: 'READY_FOR_PAYMENT' }],
      branchCount: 2, // multi-branch tenant, actor homed to clinic-1
    });
    const board = await withTenant(() => service.board('clinic-OTHER'));
    expect(board.rows).toHaveLength(0);
    expect(board.mayCompleteVisits).toBe(false);
  });
});
