import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { InvoiceService } from './invoice.service';
import { VisitService } from './visit.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';
import { ApplyLineDiscountDto } from './dto/apply-line-discount.dto';

// ===========================================================================
// G4.5d3c-3b1 (D-093) — THE INVOICE SERVICE AFTER THE BILLING CLOSURE
//
// What changed and is pinned here:
//   - sourced-line prices are the SERVER'S (precedence: specific panel price
//     → cash + markup → cash); a client figure is ignored;
//   - every mutation runs the responsibility writer, so
//     patient/panelResponsibilityAmount are REAL after production flows;
//   - line removal is auditable cancellation, never deletion;
//   - discounts are owner/finance, reasoned, guarded and locked;
//   - pay() reads the persisted split and refuses the unresolved.
// ===========================================================================

interface World {
  /** The visit's benefit snapshot as benefitFor() reads it. */
  visit?: Record<string, unknown>;
  invoice?: Record<string, unknown>;
  lines?: Array<Record<string, unknown>>;
  /** D-094 — active tariff rules for the consultation resolver ([] = feature off). */
  tariffRules?: Array<Record<string, unknown>>;
  /** D-094 — the visit as the consultation resolver reads it. */
  consultVisit?: Record<string, unknown>;
  /** D-094 — existing consultation lines (active/cancelled) for the visit. */
  consultationLines?: Array<Record<string, unknown>>;
  /** D-094 — worklist sources for pay-time completeness checks. */
  worklistPrescriptions?: Array<Record<string, unknown>>;
  worklistOrders?: Array<Record<string, unknown>>;
}

const CASH_VISIT = {
  panelClinicId: null,
  panelVerificationStatus: null,
  panelCoverageType: null,
  panelVisitLimitAmount: null,
  panelCopaymentType: null,
  panelCopaymentValue: null,
};

const VERIFIED_PANEL_VISIT = {
  panelClinicId: 'panel-aia',
  panelVerificationStatus: 'VERIFIED',
  panelCoverageType: 'VISIT_LIMIT',
  panelVisitLimitAmount: 200,
  panelCopaymentType: 'FIXED_AMOUNT',
  panelCopaymentValue: 10,
};

const UNRESOLVED_PANEL_VISIT = {
  ...CASH_VISIT,
  panelClinicId: 'panel-aia',
  panelVerificationStatus: 'PENDING_VERIFICATION',
};

function createService(role = 'FINANCE_STAFF', world: World = {}) {
  const visitState = { ...CASH_VISIT, ...(world.visit ?? {}) };
  const lines = world.lines ?? [];
  const invoiceState: Record<string, unknown> = {
    id: 'inv-1',
    visitId: 'visit-1',
    status: InvoiceStatus.UNPAID,
    invoiceNumber: 'INV-000001',
    invoiceDiscountType: null,
    invoiceDiscountValue: null,
    subtotalAmount: lines.reduce((s, l) => s + Number(l.amount ?? 0), 0),
    patientResponsibilityAmount: null,
    panelResponsibilityAmount: null,
    lines,
    ...(world.invoice ?? {}),
  };

  const prisma = {
    invoice: {
      findUnique: jest.fn(async () => invoiceState),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(async ({ data }: { data: object }) => ({ ...invoiceState, ...data })),
    },
  } as unknown as TenantScopedPrismaClient;
  const visits = {
    findById: jest.fn().mockResolvedValue({ id: 'visit-1', staffId: 'attending-staff' }),
  } as unknown as VisitService;

  const tx = {
    $executeRaw: jest.fn(),
    staff: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'staff-1',
        fullName: 'Aminah Counter',
        role,
        active: true,
        clinicId: 'clinic-1',
        userId: 'user-1',
      }),
    },
    clinic: { count: jest.fn().mockResolvedValue(1) },
    userClinicAccess: { findMany: jest.fn().mockResolvedValue([]) },
    visit: {
      // Serves the branch check ({clinicId}), the consultation resolver's
      // read (recognised by its `classification` select) and the benefit
      // snapshot — three different selects against one mock.
      findUnique: jest.fn(async ({ select }: { select?: Record<string, unknown> }) => {
        if (select?.classification || select?.queueTicket) {
          return {
            id: 'visit-1',
            clinicId: 'clinic-1',
            classification: null,
            checkInAt: new Date('2026-08-04T02:00:00Z'), // 10:00 KL
            clinic: { timezone: 'Asia/Kuala_Lumpur' },
            queueTicket: { queueType: 'WALK_IN', status: 'IN_CONSULTATION', calledAt: null },
            ...(world.consultVisit ?? {}),
          };
        }
        if (select?.clinicId && !select?.panelClinicId) {
          return { clinicId: 'clinic-1' };
        }
        return visitState;
      }),
    },
    // §36 — the deposit lookup on invoice creation. No appointment produced
    // this visit by default, which is the walk-in case and the common one.
    appointment: {
      findFirst: jest.fn().mockResolvedValue(null),
      // §36 hardening — cancel() releases any deposit linked to the invoice.
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(async ({ data }: { data: object }) => data),
    },
    appointmentEvent: { create: jest.fn(async ({ data }: { data: object }) => data) },
    invoice: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }: { data: object }) => ({ ...invoiceState, ...data })),
      findUnique: jest.fn(async () => invoiceState),
      findMany: jest.fn().mockResolvedValue([{ id: 'inv-1' }]),
      update: jest.fn(async ({ data }: { data: object }) => {
        Object.assign(invoiceState, data);
        return { ...invoiceState };
      }),
    },
    invoiceLine: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
        if (where?.sourceConsultationVisitId) return world.consultationLines ?? [];
        return lines;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const line = { id: `line-${lines.length + 1}`, cancelledAt: null, ...data };
        lines.push(line);
        invoiceState.lines = lines;
        return line;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const line = lines.find((l) => l.id === where.id);
        if (line) Object.assign(line, data);
        return line;
      }),
    },
    prescription: {
      findUnique: jest.fn().mockResolvedValue({
        itemId: 'item-1',
        // PIECE 4 — a medicine is charged in PACKS. A divisor of 1 means one
        // dose per pack, which keeps every case below at the arithmetic it was
        // written for; the pack-pricing cases state their own divisor.
        item: { sellPrice: 10, quantityPerStockUnit: 1, unitsPerPack: null, dispensedWholeAt: null },
        // D-094 — a chargeable medication source by default: DISPENSED and
        // clinic-dispensed, with the SOURCE quantity the server must use.
        status: 'DISPENSED',
        supplyMode: 'ONSITE_DISPENSE',
        quantity: 1,
        deletedAt: null,
      }),
      findMany: jest.fn(async () => world.worklistPrescriptions ?? []),
    },
    orderService: {
      findUnique: jest.fn().mockResolvedValue({
        serviceCatalogId: 'svc-1',
        serviceCatalog: { price: 30 },
        orderType: 'STANDARD_SERVICE',
        status: 'PENDING',
        // b2 PHASE E — the order's own quantity. NOT NULL at 1 in the schema,
        // so every row has one.
        quantity: 1,
      }),
      findMany: jest.fn(async () => world.worklistOrders ?? []),
    },
    serviceCatalog: {
      findUnique: jest.fn().mockResolvedValue({ price: 35 }),
    },
    consultationTariffRule: { findMany: jest.fn(async () => world.tariffRules ?? []) },
    visitWorkflowEvent: { findFirst: jest.fn().mockResolvedValue(null) },
    panelClinic: {
      findUnique: jest.fn().mockResolvedValue({ inventoryMarkupAmount: null, serviceMarkupAmount: null }),
    },
    panelPriceOverride: { findFirst: jest.fn().mockResolvedValue(null) },
    panelExclusion: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const rawPrisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;

  return { service: new InvoiceService(prisma, rawPrisma, visits), prisma, visits, tx, invoiceState, lines };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant', staffId: 'staff-1' }, fn);
}

// =============================================================================
// G3c closure (D-066) — the billing authorisation matrix, extended by D-093's
// APPLY_DISCOUNT tier. Asserted as data so table and guard cannot drift.
// =============================================================================
describe('billing authorisation', () => {
  const ACTIONS = {
    create: (s: InvoiceService) => s.create({ visitId: 'visit-1', createdByStaffId: 'staff-1' }),
    addLine: (s: InvoiceService) => s.addLine('inv-1', { description: 'X', unitPrice: 10 }),
    pay: (s: InvoiceService) => s.pay('inv-1', { paymentMethod: 'CASH' }),
    cancel: (s: InvoiceService) => s.cancel('inv-1', { cancelReason: 'x' }),
    discount: (s: InvoiceService) =>
      s.applyInvoiceDiscount('inv-1', { type: 'FIXED_AMOUNT', value: 1, reason: 'goodwill' } as never),
    cancelLine: (s: InvoiceService) => s.cancelLine('inv-1', 'line-1', { cancelReason: 'billing correction' }),
  };

  const MATRIX: [string, (keyof typeof ACTIONS)[]][] = [
    ['OWNER_ADMIN', ['create', 'addLine', 'pay', 'cancel', 'discount', 'cancelLine']],
    ['FINANCE_STAFF', ['create', 'addLine', 'pay', 'cancel', 'discount', 'cancelLine']],
    // 5. Front desk bills, collects and corrects lines (incl. waiving a
    // consultation, D-094) but NEVER discounts (owner decision 5).
    ['FRONT_DESK_CLINICAL_STAFF', ['create', 'addLine', 'pay', 'cancelLine']],
    // TASK 1, owner decision 2 — doctors now hold `billing.counter`. A
    // 24-hour clinic runs night shifts with a skeleton counter and the doctor
    // on duty raises the bill and takes the money; refusing that did not make
    // the clinic safer, it made the doctor use somebody else's login. What no
    // doctor holds is `billing.corrections`: discount and invoice
    // cancellation stay out of clinical hands.
    ['DOCTOR_RESIDENT', ['create', 'addLine', 'pay', 'cancelLine']],
    ['DOCTOR_LOCUM', ['create', 'addLine', 'pay', 'cancelLine']],
    ['HR_STAFF', []],
    ['STOCK_STAFF', []],
    // TASK 1, owner decision 1 — panel claims are billing work, so the legacy
    // fallback grants PANEL_STAFF `billing.counter`. A widening, on record:
    // the role held no billing action before. Zero accounts hold it.
    ['PANEL_STAFF', ['create', 'addLine', 'pay', 'cancelLine']],
    ['PATIENT_PORTAL', []],
  ];

  const arrange = (role: string) =>
    createService(role, {
      invoice: { patientResponsibilityAmount: 10, panelResponsibilityAmount: 0 },
      lines: [{ id: 'line-1', amount: 10, excludedFromPanel: false, cancelledAt: null, lineDiscountType: null, lineDiscountValue: null }],
    });

  for (const [role, allowed] of MATRIX) {
    for (const action of Object.keys(ACTIONS) as (keyof typeof ACTIONS)[]) {
      const permitted = allowed.includes(action);
      it(`${role} ${permitted ? 'may' : 'may NOT'} ${action}`, async () => {
        const { service } = arrange(role);
        const run = () => withTenant(() => ACTIONS[action](service));
        if (permitted) {
          await expect(run()).resolves.toBeDefined();
        } else {
          await expect(run()).rejects.toThrow(ForbiddenException);
        }
      });
    }
  }

  it('an inactive staff member may do nothing, whatever their role', async () => {
    const ctx = arrange('FINANCE_STAFF');
    ctx.tx.staff.findUnique.mockResolvedValue({
      id: 'staff-1', fullName: 'Former Finance', role: 'FINANCE_STAFF', active: false, clinicId: 'clinic-1', userId: 'user-1',
    });
    await expect(withTenant(() => ACTIONS.pay(ctx.service))).rejects.toThrow();
  });

  it('a mutation resolves the branch from the invoice’s stored visit', async () => {
    const ctx = arrange('FINANCE_STAFF');
    ctx.tx.clinic.count.mockResolvedValue(2);
    ctx.tx.visit.findUnique.mockResolvedValue({ clinicId: 'clinic-OTHER' });
    await expect(withTenant(() => ACTIONS.pay(ctx.service))).rejects.toThrow(ForbiddenException);
  });

  it('a mutation against an unknown invoice fails closed', async () => {
    const ctx = arrange('FINANCE_STAFF');
    (ctx.prisma.invoice.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(withTenant(() => ACTIONS.pay(ctx.service))).rejects.toThrow(NotFoundException);
  });
});

// =============================================================================
// 35/36. THE RESPONSIBILITY WRITER, in production flows.
// =============================================================================
describe('responsibility writer', () => {
  it('1/35. a cash invoice resolves immediately: responsibility written at creation', async () => {
    const ctx = createService('FINANCE_STAFF');
    await withTenant(() => ctx.service.create({ visitId: 'visit-1', createdByStaffId: 'staff-1' }));
    expect(ctx.invoiceState.patientResponsibilityAmount).toBe(0);
    expect(ctx.invoiceState.panelResponsibilityAmount).toBe(0);
  });

  it('35/36. adding a line writes BOTH responsibilities and the totals', async () => {
    const ctx = createService('FINANCE_STAFF');
    await withTenant(() => ctx.service.addLine('inv-1', { description: 'Consultation', quantity: 3, unitPrice: 50 }));
    expect(ctx.invoiceState).toMatchObject({
      subtotalAmount: 150,
      totalAmount: 150,
      patientResponsibilityAmount: 150,
      panelResponsibilityAmount: 0,
    });
  });

  it('2. an unresolved panel visit stays NULL — never guessed', async () => {
    const ctx = createService('FINANCE_STAFF', { visit: UNRESOLVED_PANEL_VISIT });
    await withTenant(() => ctx.service.addLine('inv-1', { description: 'Med', unitPrice: 50 }));
    expect(ctx.invoiceState.patientResponsibilityAmount).toBeNull();
    expect(ctx.invoiceState.panelResponsibilityAmount).toBeNull();
    expect(ctx.invoiceState.totalAmount).toBe(50);
  });

  it('a VERIFIED panel visit computes the split from the SNAPSHOT terms', async () => {
    const ctx = createService('FINANCE_STAFF', { visit: VERIFIED_PANEL_VISIT });
    await withTenant(() => ctx.service.addLine('inv-1', { description: 'Bundle', quantity: 1, unitPrice: 250 }));
    // Limit 200, fixed copay 10 → panel 190, patient 60 (owner case D).
    expect(ctx.invoiceState).toMatchObject({
      panelResponsibilityAmount: 190,
      patientResponsibilityAmount: 60,
      totalAmount: 250,
    });
  });

  it('38. the persisted identity holds: total = panel + patient', async () => {
    const ctx = createService('FINANCE_STAFF', { visit: VERIFIED_PANEL_VISIT });
    await withTenant(() => ctx.service.addLine('inv-1', { description: 'A', unitPrice: 123.45 }));
    const total = Number(ctx.invoiceState.totalAmount);
    const panel = Number(ctx.invoiceState.panelResponsibilityAmount);
    const patient = Number(ctx.invoiceState.patientResponsibilityAmount);
    expect(total).toBeCloseTo(panel + patient, 2);
  });

  it('37. line-level responsibility is persisted alongside', async () => {
    const ctx = createService('FINANCE_STAFF', { visit: VERIFIED_PANEL_VISIT });
    await withTenant(() => ctx.service.addLine('inv-1', { description: 'A', unitPrice: 250 }));
    const line = ctx.lines[0];
    expect(Number(line.panelResponsibilityAmount)).toBe(190);
    expect(Number(line.patientResponsibilityAmount)).toBe(60);
  });
});

// =============================================================================
// 11–15. SERVER-SIDE PRICING.
// =============================================================================
describe('server-side pricing', () => {
  const sourcedAdd = (ctx: ReturnType<typeof createService>, dto: Record<string, unknown> = {}) =>
    withTenant(() =>
      ctx.service.addLine('inv-1', {
        description: 'Amoxicillin',
        sourcePrescriptionId: 'rx-1',
        ...dto,
      } as never),
    );

  it('15. a client-supplied price on a SOURCED line is ignored — the server resolves it', async () => {
    const ctx = createService('FINANCE_STAFF');
    await sourcedAdd(ctx, { unitPrice: 999 });
    const created = (ctx.tx.invoiceLine.create as jest.Mock).mock.calls[0][0].data;
    expect(created.unitPrice).toBe(10); // the item's cash price, not 999
    expect(created.priceRule).toBe('CASH');
    expect(created.baseUnitPrice).toBe(10);
  });

  it('12. panel visit: cash + markup, provenance retained', async () => {
    const ctx = createService('FINANCE_STAFF', { visit: VERIFIED_PANEL_VISIT });
    ctx.tx.panelClinic.findUnique.mockResolvedValue({ inventoryMarkupAmount: 2, serviceMarkupAmount: 5 });
    await sourcedAdd(ctx);
    const created = (ctx.tx.invoiceLine.create as jest.Mock).mock.calls[0][0].data;
    expect(created).toMatchObject({ unitPrice: 12, priceRule: 'CASH_PLUS_MARKUP', baseUnitPrice: 10, panelMarkupAmount: 2 });
  });

  it('11. a specific panel price REPLACES the markup', async () => {
    const ctx = createService('FINANCE_STAFF', { visit: VERIFIED_PANEL_VISIT });
    ctx.tx.panelClinic.findUnique.mockResolvedValue({ inventoryMarkupAmount: 2, serviceMarkupAmount: null });
    ctx.tx.panelPriceOverride.findFirst.mockResolvedValue({ overridePrice: 18 });
    await sourcedAdd(ctx);
    const created = (ctx.tx.invoiceLine.create as jest.Mock).mock.calls[0][0].data;
    expect(created).toMatchObject({ unitPrice: 18, priceRule: 'SPECIFIC_PANEL_PRICE', panelMarkupAmount: null });
  });

  it('service lines use the SERVICE markup, not the inventory one', async () => {
    const ctx = createService('FINANCE_STAFF', { visit: VERIFIED_PANEL_VISIT });
    ctx.tx.panelClinic.findUnique.mockResolvedValue({ inventoryMarkupAmount: 2, serviceMarkupAmount: 5 });
    await withTenant(() =>
      ctx.service.addLine('inv-1', { description: 'Nebuliser', sourceOrderServiceId: 'os-1' } as never),
    );
    const created = (ctx.tx.invoiceLine.create as jest.Mock).mock.calls[0][0].data;
    expect(created).toMatchObject({ unitPrice: 35, priceRule: 'CASH_PLUS_MARKUP', baseUnitPrice: 30, panelMarkupAmount: 5 });
  });

  it('14. a free-text manual line is stamped MANUAL at the biller’s price', async () => {
    const ctx = createService('FINANCE_STAFF');
    await withTenant(() => ctx.service.addLine('inv-1', { description: 'Consultation', unitPrice: 45 }));
    const created = (ctx.tx.invoiceLine.create as jest.Mock).mock.calls[0][0].data;
    expect(created).toMatchObject({ priceRule: 'MANUAL', unitPrice: 45, baseUnitPrice: 45 });
  });

  it('a manual line without a price is refused', async () => {
    const ctx = createService('FINANCE_STAFF');
    await expect(withTenant(() => ctx.service.addLine('inv-1', { description: 'X' } as never))).rejects.toThrow(
      /manual line needs a unit price/i,
    );
  });

  it('a sourced line whose catalog row vanished cannot fall back to a client price', async () => {
    const ctx = createService('FINANCE_STAFF');
    ctx.tx.prescription.findUnique.mockResolvedValue({
      itemId: 'item-1', item: null, status: 'DISPENSED', supplyMode: 'ONSITE_DISPENSE', quantity: 1, deletedAt: null,
    });
    await expect(sourcedAdd(ctx, { unitPrice: 999 })).rejects.toThrow(/cannot be priced/i);
  });

  it('the exclusion reason is snapshotted onto the line', async () => {
    const ctx = createService('FINANCE_STAFF', { visit: VERIFIED_PANEL_VISIT });
    ctx.tx.panelExclusion.findFirst.mockResolvedValue({ reason: 'Supplements not covered' });
    await sourcedAdd(ctx);
    const created = (ctx.tx.invoiceLine.create as jest.Mock).mock.calls[0][0].data;
    expect(created).toMatchObject({ excludedFromPanel: true, panelExclusionReason: 'Supplements not covered' });
  });
});

// =============================================================================
// 16–23. DISCOUNTS.
// =============================================================================
describe('discounts', () => {
  const withLine = (world: World = {}) =>
    createService('FINANCE_STAFF', {
      lines: [{ id: 'line-1', amount: 40, excludedFromPanel: false, cancelledAt: null, lineDiscountType: null, lineDiscountValue: null }],
      ...world,
    });

  it('16/17. a line discount stores type, value, reason, actor and stamp — and recalculates', async () => {
    const ctx = withLine();
    await withTenant(() =>
      ctx.service.applyLineDiscount('inv-1', 'line-1', { type: 'PERCENTAGE', value: 10, reason: 'Staff family rate' } as never),
    );
    const line = ctx.lines[0];
    expect(line).toMatchObject({
      lineDiscountType: 'PERCENTAGE',
      lineDiscountValue: 10,
      lineDiscountReason: 'Staff family rate',
      lineDiscountByStaffId: 'staff-1',
      lineDiscountAmount: 4,
    });
    expect(ctx.invoiceState.totalAmount).toBe(36);
    expect(ctx.invoiceState.patientResponsibilityAmount).toBe(36);
  });

  it('20. a fixed line discount larger than the line is refused', async () => {
    const ctx = withLine();
    await expect(
      withTenant(() => ctx.service.applyLineDiscount('inv-1', 'line-1', { type: 'FIXED_AMOUNT', value: 500, reason: 'oops' } as never)),
    ).rejects.toThrow(/cannot exceed the line amount/i);
  });

  it('a percentage above 100 is refused', async () => {
    const ctx = withLine();
    await expect(
      withTenant(() => ctx.service.applyLineDiscount('inv-1', 'line-1', { type: 'PERCENTAGE', value: 120, reason: 'no' } as never)),
    ).rejects.toThrow(/cannot exceed 100/i);
  });

  it('18. overall discount on a cash invoice reduces the (fully patient) total', async () => {
    const ctx = withLine({ invoice: { subtotalAmount: 40 } });
    await withTenant(() =>
      ctx.service.applyInvoiceDiscount('inv-1', { type: 'FIXED_AMOUNT', value: 10, reason: 'Loyalty' } as never),
    );
    expect(ctx.invoiceState).toMatchObject({
      invoiceDiscountAmount: 10,
      totalAmount: 30,
      patientResponsibilityAmount: 30,
      invoiceDiscountByStaffId: 'staff-1',
    });
  });

  it('19. overall discount on a panel invoice reduces ONLY the patient portion', async () => {
    const ctx = createService('FINANCE_STAFF', {
      visit: VERIFIED_PANEL_VISIT,
      invoice: { subtotalAmount: 250 },
      lines: [{ id: 'line-1', amount: 250, excludedFromPanel: false, cancelledAt: null, lineDiscountType: null, lineDiscountValue: null }],
    });
    await withTenant(() =>
      ctx.service.applyInvoiceDiscount('inv-1', { type: 'FIXED_AMOUNT', value: 20, reason: 'Goodwill' } as never),
    );
    // Panel keeps its contractual 190; patient 60 − 20 = 40.
    expect(ctx.invoiceState).toMatchObject({
      panelResponsibilityAmount: 190,
      patientResponsibilityAmount: 40,
      totalAmount: 230,
    });
  });

  it('an overall discount is refused while responsibility is unresolved', async () => {
    const ctx = withLine({ visit: UNRESOLVED_PANEL_VISIT, invoice: { subtotalAmount: 40 } });
    await expect(
      withTenant(() => ctx.service.applyInvoiceDiscount('inv-1', { type: 'FIXED_AMOUNT', value: 5, reason: 'x' } as never)),
    ).rejects.toThrow(/Billing responsibility has not been confirmed/);
  });

  it('23. a PAID invoice refuses discounts', async () => {
    const ctx = withLine({ invoice: { status: InvoiceStatus.PAID } });
    await expect(
      withTenant(() => ctx.service.applyLineDiscount('inv-1', 'line-1', { type: 'PERCENTAGE', value: 5, reason: 'late' } as never)),
    ).rejects.toThrow(/status PAID/);
  });

  it('21. the DTO refuses a discount without a reason', () => {
    const dto = plainToInstance(ApplyLineDiscountDto, { type: 'PERCENTAGE', value: 10 });
    const errors = validateSync(dto);
    expect(errors.some((e) => e.property === 'reason')).toBe(true);
  });
});

// =============================================================================
// 24/25. AUDITABLE LINE CANCELLATION.
// =============================================================================
describe('line cancellation', () => {
  const withLines = () =>
    createService('FINANCE_STAFF', {
      lines: [
        { id: 'line-1', amount: 100, excludedFromPanel: false, cancelledAt: null, lineDiscountType: null, lineDiscountValue: null },
        { id: 'line-2', amount: 40, excludedFromPanel: false, cancelledAt: null, lineDiscountType: null, lineDiscountValue: null },
      ],
    });

  it('24. cancellation stamps actor, time and reason — and preserves the row', async () => {
    const ctx = withLines();
    await withTenant(() => ctx.service.cancelLine('inv-1', 'line-2', { cancelReason: 'Charged in error' }));
    const line = ctx.lines.find((l) => l.id === 'line-2')!;
    expect(line.cancelledAt).toBeInstanceOf(Date);
    expect(line).toMatchObject({ cancelledByStaffId: 'staff-1', cancelReason: 'Charged in error' });
    // Never deleted.
    expect(ctx.lines).toHaveLength(2);
  });

  it('25. a cancelled line leaves the totals and the responsibility', async () => {
    const ctx = withLines();
    await withTenant(() => ctx.service.cancelLine('inv-1', 'line-2', { cancelReason: 'billing correction' }));
    expect(ctx.invoiceState).toMatchObject({
      subtotalAmount: 100,
      totalAmount: 100,
      patientResponsibilityAmount: 100,
    });
  });

  it('an already-cancelled line cannot be cancelled again', async () => {
    const ctx = withLines();
    await withTenant(() => ctx.service.cancelLine('inv-1', 'line-2', { cancelReason: 'billing correction' }));
    await expect(withTenant(() => ctx.service.cancelLine('inv-1', 'line-2', { cancelReason: 'billing correction' }))).rejects.toThrow(/already cancelled/i);
  });

  it('a line not on this invoice is a 404', async () => {
    const ctx = withLines();
    await expect(withTenant(() => ctx.service.cancelLine('inv-1', 'missing', { cancelReason: 'billing correction' }))).rejects.toThrow(NotFoundException);
  });

  it('cancellation is refused once the invoice is PAID', async () => {
    const ctx = createService('FINANCE_STAFF', {
      invoice: { status: InvoiceStatus.PAID },
      lines: [{ id: 'line-1', amount: 10, excludedFromPanel: false, cancelledAt: null, lineDiscountType: null, lineDiscountValue: null }],
    });
    await expect(withTenant(() => ctx.service.cancelLine('inv-1', 'line-1', { cancelReason: 'billing correction' }))).rejects.toThrow(/status PAID/);
  });
});

// =============================================================================
// D-073 — duplicate-source protection, now cancellation-aware.
// =============================================================================
describe('duplicate charge prevention (44)', () => {
  it('refuses a second ACTIVE line for the same source, naming the invoice', async () => {
    const ctx = createService('FINANCE_STAFF');
    ctx.tx.invoiceLine.findFirst.mockResolvedValue({ invoice: { invoiceNumber: 'INV-000007' } });
    await expect(
      withTenant(() => ctx.service.addLine('inv-1', { description: 'X', sourcePrescriptionId: 'rx-1' } as never)),
    ).rejects.toThrow(ConflictException);
  });

  it('the duplicate check ignores CANCELLED lines — a cancelled charge is not a standing claim', async () => {
    const ctx = createService('FINANCE_STAFF');
    await withTenant(() => ctx.service.addLine('inv-1', { description: 'X', sourcePrescriptionId: 'rx-1' } as never));
    const where = ctx.tx.invoiceLine.findFirst.mock.calls[0][0].where;
    expect(where.cancelledAt).toBeNull();
  });

  it('locks the source row before checking, so concurrent adds serialise', async () => {
    const ctx = createService('FINANCE_STAFF');
    await withTenant(() => ctx.service.addLine('inv-1', { description: 'X', sourceOrderServiceId: 'os-1' } as never));
    const sql = String(ctx.tx.$executeRaw.mock.calls.map((c: unknown[]) => c[0]).flat());
    expect(sql).toContain('FOR UPDATE');
  });

  it('a freehand line with no source is never blocked', async () => {
    const ctx = createService('FINANCE_STAFF');
    await withTenant(() => ctx.service.addLine('inv-1', { description: 'Water', unitPrice: 2 }));
    expect(ctx.tx.invoiceLine.findFirst).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 40/41/42. PAY reads persisted state only.
// =============================================================================
describe('pay', () => {
  it('40. refuses while responsibility is unresolved, in the approved wording', async () => {
    const ctx = createService('FINANCE_STAFF', {
      invoice: { patientResponsibilityAmount: null },
    });
    await expect(withTenant(() => ctx.service.pay('inv-1', { paymentMethod: 'CASH' }))).rejects.toThrow(
      'Billing responsibility has not been confirmed.',
    );
  });

  it('40b. refuses an unresolved panel verification even if a number exists', async () => {
    const ctx = createService('FINANCE_STAFF', {
      visit: UNRESOLVED_PANEL_VISIT,
      invoice: { patientResponsibilityAmount: 50, panelResponsibilityAmount: 100 },
    });
    await expect(withTenant(() => ctx.service.pay('inv-1', { paymentMethod: 'CASH' }))).rejects.toThrow(
      'Billing responsibility has not been confirmed.',
    );
  });

  it('41. settles from the PERSISTED split — the live panel is never consulted', async () => {
    const ctx = createService('FINANCE_STAFF', {
      visit: VERIFIED_PANEL_VISIT,
      invoice: { patientResponsibilityAmount: 60, panelResponsibilityAmount: 190 },
    });
    await withTenant(() => ctx.service.pay('inv-1', { paymentMethod: 'CASH' }));
    expect(ctx.invoiceState).toMatchObject({
      status: InvoiceStatus.PAID,
      patientPaidAmount: 60,
      panelCoveredAmount: 190,
    });
    // The pricing tables were never touched at pay-time.
    expect(ctx.tx.panelClinic.findUnique).not.toHaveBeenCalled();
    expect(ctx.tx.panelPriceOverride.findFirst).not.toHaveBeenCalled();
    expect(ctx.tx.panelExclusion.findFirst).not.toHaveBeenCalled();
  });

  it('39. paying the persisted responsibility resolves the remaining balance to zero', async () => {
    const ctx = createService('FINANCE_STAFF', {
      invoice: { patientResponsibilityAmount: 85, panelResponsibilityAmount: 0 },
    });
    await withTenant(() => ctx.service.pay('inv-1', { paymentMethod: 'CASH' }));
    const remaining = Math.max(
      Number(ctx.invoiceState.patientResponsibilityAmount) - Number(ctx.invoiceState.patientPaidAmount),
      0,
    );
    expect(remaining).toBe(0);
  });

  it('"Mark Fully Covered by Panel" requires a persisted patient responsibility of zero', async () => {
    const due = createService('FINANCE_STAFF', {
      visit: VERIFIED_PANEL_VISIT,
      invoice: { patientResponsibilityAmount: 10, panelResponsibilityAmount: 190 },
    });
    await expect(withTenant(() => due.service.pay('inv-1', { paymentMethod: 'PANEL' }))).rejects.toThrow(/copay/i);

    const clear = createService('FINANCE_STAFF', {
      visit: VERIFIED_PANEL_VISIT,
      invoice: { patientResponsibilityAmount: 0, panelResponsibilityAmount: 200 },
    });
    await withTenant(() => clear.service.pay('inv-1', { paymentMethod: 'PANEL' }));
    expect(clear.invoiceState).toMatchObject({ status: InvoiceStatus.PAID, patientPaidAmount: 0, panelCoveredAmount: 200 });
  });

  it('a PAID invoice cannot be paid again; a CANCELLED one neither', async () => {
    const paid = createService('FINANCE_STAFF', { invoice: { status: InvoiceStatus.PAID, patientResponsibilityAmount: 0 } });
    await expect(withTenant(() => paid.service.pay('inv-1', { paymentMethod: 'CASH' }))).rejects.toThrow(/status PAID/);
    const cancelled = createService('FINANCE_STAFF', { invoice: { status: InvoiceStatus.CANCELLED, patientResponsibilityAmount: 0 } });
    await expect(withTenant(() => cancelled.service.pay('inv-1', { paymentMethod: 'CASH' }))).rejects.toThrow(/status CANCELLED/);
  });
});

// =============================================================================
// 42. LEGACY invoices are never silently backfilled.
// =============================================================================
describe('legacy handling', () => {
  it('42. the recalculator refuses to touch a PAID legacy invoice', async () => {
    const ctx = createService('FINANCE_STAFF', {
      invoice: { status: InvoiceStatus.PAID, patientResponsibilityAmount: null },
    });
    await withTenant(async () => {
      const rawPrisma = (ctx.service as unknown as { rawPrisma: PrismaService }).rawPrisma;
      await rawPrisma.$transaction(async (tx) => ctx.service.recalculateInvoice(tx as never, 'inv-1'));
    });
    // No totals written, no responsibility invented: PAID history is frozen.
    expect(ctx.invoiceState.patientResponsibilityAmount).toBeNull();
    expect(ctx.tx.invoiceLine.update).not.toHaveBeenCalled();
  });

  it('recalculateVisitInvoices touches only UNPAID invoices', async () => {
    const ctx = createService('FINANCE_STAFF');
    await withTenant(() => ctx.service.recalculateVisitInvoices('visit-1'));
    const where = ctx.tx.invoice.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ visitId: 'visit-1', status: InvoiceStatus.UNPAID });
  });
});

// =============================================================================
// G4.5d3c-3b2 (D-094) — SOURCED QUANTITY TRUTH (owner tests 26–32).
// =============================================================================
describe('sourced quantity truth', () => {
  it('26/28. medication quantity comes from the Prescription — a client figure is ignored', async () => {
    const ctx = createService('FINANCE_STAFF');
    ctx.tx.prescription.findUnique.mockResolvedValue({
      itemId: 'item-1', item: { sellPrice: 10, quantityPerStockUnit: 1, unitsPerPack: null, dispensedWholeAt: null }, status: 'DISPENSED', supplyMode: 'ONSITE_DISPENSE', quantity: 7, deletedAt: null,
    });
    await withTenant(() =>
      ctx.service.addLine('inv-1', { description: 'Med', sourcePrescriptionId: 'rx-1', quantity: 99 } as never),
    );
    const created = (ctx.tx.invoiceLine.create as jest.Mock).mock.calls[0][0].data;
    expect(created.quantity).toBe(7);
    expect(created.amount).toBe(70);
  });

  // ===========================================================================
  // PIECE 4 — A MEDICINE IS CHARGED IN PACKS.
  //
  // `sellPrice` is the price of one STOCK UNIT, which the clinic's own import
  // settles: RM155.00 against "10 BIJI / STRIP" is a course of Tamiflu, not one
  // capsule. Quantity × unitPrice bills that course at RM1,550.
  // ===========================================================================

  it('stores the number of PACKS, so a ten-capsule course bills as one strip', async () => {
    const ctx = createService('FINANCE_STAFF');
    ctx.tx.prescription.findUnique.mockResolvedValue({
      itemId: 'item-1',
      item: { sellPrice: 155, quantityPerStockUnit: 10, unitsPerPack: null, dispensedWholeAt: null },
      status: 'DISPENSED', supplyMode: 'ONSITE_DISPENSE', quantity: 10, deletedAt: null,
    });
    await withTenant(() =>
      ctx.service.addLine('inv-1', { description: 'Oseltamivir', sourcePrescriptionId: 'rx-1' } as never),
    );
    const created = (ctx.tx.invoiceLine.create as jest.Mock).mock.calls[0][0].data;
    // The stored quantity is what a printed bill reads: "1 x RM155.00".
    expect(created.quantity).toBe(1);
    expect(created.amount).toBe(155);
  });

  it('rounds a partial pack UP — charging for two of three strips gives one away', async () => {
    const ctx = createService('FINANCE_STAFF');
    ctx.tx.prescription.findUnique.mockResolvedValue({
      itemId: 'item-1',
      item: { sellPrice: 26, quantityPerStockUnit: 10, unitsPerPack: null, dispensedWholeAt: null },
      status: 'DISPENSED', supplyMode: 'ONSITE_DISPENSE', quantity: 25, deletedAt: null,
    });
    await withTenant(() =>
      ctx.service.addLine('inv-1', { description: 'Celecoxib', sourcePrescriptionId: 'rx-1' } as never),
    );
    const created = (ctx.tx.invoiceLine.create as jest.Mock).mock.calls[0][0].data;
    expect(created.quantity).toBe(3);
    expect(created.amount).toBe(78);
  });

  it('REFUSES a medicine with no divisor rather than assuming 1', async () => {
    // A divisor of 1 assumed here is the same arithmetic that produced the
    // RM1,550. The draft may LIST such a line unpriced; a real invoice line is
    // a charge somebody pays, and it cannot be created without a number.
    const ctx = createService('FINANCE_STAFF');
    ctx.tx.prescription.findUnique.mockResolvedValue({
      itemId: 'item-1',
      item: { sellPrice: 26, quantityPerStockUnit: null, unitsPerPack: null, dispensedWholeAt: null },
      status: 'DISPENSED', supplyMode: 'ONSITE_DISPENSE', quantity: 30, deletedAt: null,
    });
    await expect(
      withTenant(() => ctx.service.addLine('inv-1', { description: 'X', sourcePrescriptionId: 'rx-1' } as never)),
    ).rejects.toThrow(/quantity per stock unit/);
    expect(ctx.tx.invoiceLine.create).not.toHaveBeenCalled();
  });

  it('takes the clinic’s divisor over the import’s parse', async () => {
    const ctx = createService('FINANCE_STAFF');
    ctx.tx.prescription.findUnique.mockResolvedValue({
      itemId: 'item-1',
      item: { sellPrice: 12, quantityPerStockUnit: 12, unitsPerPack: 10, dispensedWholeAt: null },
      status: 'DISPENSED', supplyMode: 'ONSITE_DISPENSE', quantity: 24, deletedAt: null,
    });
    await withTenant(() =>
      ctx.service.addLine('inv-1', { description: 'Lozenges', sourcePrescriptionId: 'rx-1' } as never),
    );
    expect((ctx.tx.invoiceLine.create as jest.Mock).mock.calls[0][0].data.quantity).toBe(2);
  });

  it('27/29. an order-sourced line takes the ORDER\'s quantity, not the client\'s', async () => {
    // b2 PHASE E — this was hardcoded to 1, so three dressings recorded as a
    // quantity of three were billed once. The figure is a money fact and it
    // comes from the record, exactly as a prescription's does; a client's is
    // still ignored.
    const ctx = createService('FINANCE_STAFF');
    ctx.tx.orderService.findUnique.mockResolvedValue({
      serviceCatalogId: 'svc-1',
      serviceCatalog: { price: 30 },
      orderType: 'STANDARD_SERVICE',
      status: 'PENDING',
      quantity: 3,
    });
    await withTenant(() =>
      ctx.service.addLine('inv-1', { description: 'Svc', sourceOrderServiceId: 'os-1', quantity: 42 } as never),
    );
    const created = (ctx.tx.invoiceLine.create as jest.Mock).mock.calls[0][0].data;
    expect(created.quantity).toBe(3);
    expect(created.amount).toBe(90);
  });

  it('27b. a task order is billed once — it is one piece of work', async () => {
    const ctx = createService('FINANCE_STAFF');
    ctx.tx.orderService.findUnique.mockResolvedValue({
      serviceCatalogId: 'svc-1',
      serviceCatalog: { price: 30 },
      orderType: 'TASK_ORDER',
      status: 'COMPLETED',
      quantity: 1,
    });
    await withTenant(() =>
      ctx.service.addLine('inv-1', { description: 'Svc', sourceOrderServiceId: 'os-1', quantity: 42 } as never),
    );
    const created = (ctx.tx.invoiceLine.create as jest.Mock).mock.calls[0][0].data;
    expect(created.quantity).toBe(1);
  });

  it('32. a manual line accepts an explicit quantity and price — and stays MANUAL', async () => {
    const ctx = createService('FINANCE_STAFF');
    await withTenant(() => ctx.service.addLine('inv-1', { description: 'Bandage pack', quantity: 3, unitPrice: 4.5 }));
    const created = (ctx.tx.invoiceLine.create as jest.Mock).mock.calls[0][0].data;
    expect(created).toMatchObject({ quantity: 3, unitPrice: 4.5, amount: 13.5, priceRule: 'MANUAL' });
  });

  it('an ORDERED medication cannot be finalised — dispense first', async () => {
    const ctx = createService('FINANCE_STAFF');
    ctx.tx.prescription.findUnique.mockResolvedValue({
      itemId: 'item-1', item: { sellPrice: 10, quantityPerStockUnit: 1, unitsPerPack: null, dispensedWholeAt: null }, status: 'ORDERED', supplyMode: 'ONSITE_DISPENSE', quantity: 7, deletedAt: null,
    });
    await expect(
      withTenant(() => ctx.service.addLine('inv-1', { description: 'Med', sourcePrescriptionId: 'rx-1' } as never)),
    ).rejects.toThrow(/has not been dispensed/i);
  });

  it('a non-ONSITE supply mode is never a clinic medication charge', async () => {
    const ctx = createService('FINANCE_STAFF');
    ctx.tx.prescription.findUnique.mockResolvedValue({
      itemId: 'item-1', item: { sellPrice: 10, quantityPerStockUnit: 1, unitsPerPack: null, dispensedWholeAt: null }, status: 'DISPENSED', supplyMode: 'EXTERNAL_PRESCRIPTION', quantity: 7, deletedAt: null,
    });
    await expect(
      withTenant(() => ctx.service.addLine('inv-1', { description: 'Med', sourcePrescriptionId: 'rx-1' } as never)),
    ).rejects.toThrow(/dispenses on site/i);
  });

  it('an uncompleted TASK_ORDER cannot be charged', async () => {
    const ctx = createService('FINANCE_STAFF');
    ctx.tx.orderService.findUnique.mockResolvedValue({
      serviceCatalogId: 'svc-1', serviceCatalog: { price: 30 }, orderType: 'TASK_ORDER', status: 'PENDING',
    });
    await expect(
      withTenant(() => ctx.service.addLine('inv-1', { description: 'ECG', sourceOrderServiceId: 'os-1' } as never)),
    ).rejects.toThrow(/has not been completed/i);
  });
});

// =============================================================================
// G4.5d3c-3b2 (D-094) — THE CONSULTATION CHARGE (owner tests 30, 36, 52–57, 64/65).
// =============================================================================
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

describe('consultation charge', () => {
  it('36/56/30. ensure adds ONE source-linked, server-priced, quantity-1 line', async () => {
    const ctx = createService('FRONT_DESK_CLINICAL_STAFF', { tariffRules: [DAY_RULE] });
    const result = await withTenant(() => ctx.service.ensureConsultationCharge('inv-1'));
    expect(result.added).toBe(true);
    const created = (ctx.tx.invoiceLine.create as jest.Mock).mock.calls[0][0].data;
    expect(created).toMatchObject({
      description: 'Consultation (Day)',
      quantity: 1,
      unitPrice: 35, // the ServiceCatalog cash price — never a client figure
      sourceConsultationVisitId: 'visit-1',
      consultationTariffRuleId: 'rule-day',
      priceRule: 'CASH',
    });
  });

  it('52. a repeat ensure adds nothing — the active line already exists', async () => {
    const ctx = createService('FRONT_DESK_CLINICAL_STAFF', {
      tariffRules: [DAY_RULE],
      consultationLines: [{ id: 'cl-1', description: 'Consultation (Day)', cancelledAt: null }],
    });
    const result = await withTenant(() => ctx.service.ensureConsultationCharge('inv-1'));
    expect(result.added).toBe(false);
    expect(ctx.tx.invoiceLine.create).not.toHaveBeenCalled();
  });

  it('53. concurrent ensures serialise on the visit row lock', async () => {
    const ctx = createService('FRONT_DESK_CLINICAL_STAFF', { tariffRules: [DAY_RULE] });
    await withTenant(() => ctx.service.ensureConsultationCharge('inv-1'));
    expect(ctx.tx.$executeRaw).toHaveBeenCalled();
    const sql = (ctx.tx.$executeRaw as jest.Mock).mock.calls
      .map((call: unknown[]) => (call[0] as TemplateStringsArray).join('?'))
      .find((text: string) => text.includes('FOR UPDATE'));
    expect(sql).toContain('"visits"');
  });

  it('51. no matching tariff: ensure reports review and creates NOTHING', async () => {
    const ctx = createService('FRONT_DESK_CLINICAL_STAFF', {
      tariffRules: [{ ...DAY_RULE, startTime: '08:00', endTime: '09:00' }],
    });
    const result = await withTenant(() => ctx.service.ensureConsultationCharge('inv-1'));
    expect(result).toMatchObject({ added: false, state: { kind: 'TARIFF_REVIEW' } });
    expect(ctx.tx.invoiceLine.create).not.toHaveBeenCalled();
  });

  it('no tariff configured at all: ensure is a quiet no-op', async () => {
    const ctx = createService('FRONT_DESK_CLINICAL_STAFF', { tariffRules: [] });
    const result = await withTenant(() => ctx.service.ensureConsultationCharge('inv-1'));
    expect(result).toMatchObject({ added: false, state: { kind: 'NOT_CONFIGURED' } });
  });

  it('48. an exempt visit is not auto-charged', async () => {
    const ctx = createService('FRONT_DESK_CLINICAL_STAFF', {
      tariffRules: [DAY_RULE],
      consultVisit: { classification: 'OTC_ONLY' },
    });
    const result = await withTenant(() => ctx.service.ensureConsultationCharge('inv-1'));
    expect(result).toMatchObject({ added: false, state: { kind: 'EXEMPT' } });
    expect(ctx.tx.invoiceLine.create).not.toHaveBeenCalled();
  });

  it('65. a waived consultation stays waived on ensure; the EXPLICIT add brings it back', async () => {
    const world = {
      tariffRules: [DAY_RULE],
      consultationLines: [{ id: 'cl-1', description: 'Consultation (Day)', cancelledAt: new Date() }],
    };
    const auto = createService('FRONT_DESK_CLINICAL_STAFF', world);
    expect(await withTenant(() => auto.service.ensureConsultationCharge('inv-1'))).toMatchObject({
      added: false,
      state: { kind: 'WAIVED' },
    });
    expect(auto.tx.invoiceLine.create).not.toHaveBeenCalled();

    const explicit = createService('FRONT_DESK_CLINICAL_STAFF', world);
    const result = await withTenant(() => explicit.service.addConsultationCharge('inv-1'));
    expect(result.added).toBe(true);
    expect(explicit.tx.invoiceLine.create).toHaveBeenCalledTimes(1);
  });

  it('64. an exempt visit where a consultation occurred takes the EXPLICIT add', async () => {
    const ctx = createService('FRONT_DESK_CLINICAL_STAFF', {
      tariffRules: [DAY_RULE],
      consultVisit: { classification: 'DRESSING_ONLY' },
    });
    const result = await withTenant(() => ctx.service.addConsultationCharge('inv-1'));
    expect(result.added).toBe(true);
  });

  it('the explicit add against an already-billed consultation is a conflict', async () => {
    const ctx = createService('FRONT_DESK_CLINICAL_STAFF', {
      tariffRules: [DAY_RULE],
      consultationLines: [{ id: 'cl-1', description: 'Consultation (Day)', cancelledAt: null }],
    });
    await expect(withTenant(() => ctx.service.addConsultationCharge('inv-1'))).rejects.toThrow(ConflictException);
  });

  it('42/43. a panel visit prices the consultation through the approved resolver', async () => {
    const override = createService('FRONT_DESK_CLINICAL_STAFF', { visit: VERIFIED_PANEL_VISIT, tariffRules: [DAY_RULE] });
    override.tx.panelPriceOverride.findFirst.mockResolvedValue({ overridePrice: 20 });
    await withTenant(() => override.service.ensureConsultationCharge('inv-1'));
    expect((override.tx.invoiceLine.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
      unitPrice: 20,
      priceRule: 'SPECIFIC_PANEL_PRICE',
    });

    const markup = createService('FRONT_DESK_CLINICAL_STAFF', { visit: VERIFIED_PANEL_VISIT, tariffRules: [DAY_RULE] });
    markup.tx.panelClinic.findUnique.mockResolvedValue({ inventoryMarkupAmount: null, serviceMarkupAmount: 5 });
    await withTenant(() => markup.service.ensureConsultationCharge('inv-1'));
    expect((markup.tx.invoiceLine.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
      unitPrice: 40,
      priceRule: 'CASH_PLUS_MARKUP',
      panelMarkupAmount: 5,
    });
  });
});

// =============================================================================
// G4.5d3c-3b2 (D-094) — PAY-TIME COMPLETENESS (owner tests 93, 96, 97).
// =============================================================================
describe('pay-time completeness', () => {
  it('96. an unbilled READY source refuses settlement', async () => {
    const ctx = createService('FINANCE_STAFF', {
      invoice: { patientResponsibilityAmount: 10, panelResponsibilityAmount: 0 },
      worklistPrescriptions: [
        { id: 'rx-1', quantity: 5, supplyMode: 'ONSITE_DISPENSE', status: 'DISPENSED', item: { name: 'Amoxicillin' } },
      ],
    });
    await expect(withTenant(() => ctx.service.pay('inv-1', { paymentMethod: 'CASH' }))).rejects.toThrow(
      /uninvoiced: Amoxicillin/i,
    );
  });

  it('97. a consultation tariff in review refuses settlement', async () => {
    const ctx = createService('FINANCE_STAFF', {
      invoice: { patientResponsibilityAmount: 10, panelResponsibilityAmount: 0 },
      tariffRules: [{ ...DAY_RULE, startTime: '08:00', endTime: '09:00' }],
    });
    await expect(withTenant(() => ctx.service.pay('inv-1', { paymentMethod: 'CASH' }))).rejects.toThrow(
      /Consultation tariff requires review/i,
    );
  });

  it('93. PANEL requires zero patient responsibility AND a positive panel amount', async () => {
    const zeroPanel = createService('FINANCE_STAFF', {
      invoice: { patientResponsibilityAmount: 0, panelResponsibilityAmount: 0 },
    });
    await expect(withTenant(() => zeroPanel.service.pay('inv-1', { paymentMethod: 'PANEL' }))).rejects.toThrow(
      /positive amount/i,
    );

    const covered = createService('FINANCE_STAFF', {
      invoice: { patientResponsibilityAmount: 0, panelResponsibilityAmount: 45 },
    });
    const paid = await withTenant(() => covered.service.pay('inv-1', { paymentMethod: 'PANEL' }));
    expect(paid).toMatchObject({ status: 'PAID', patientPaidAmount: 0, panelCoveredAmount: 45 });
  });

  it('an ORDERED (not yet dispensed) medication does not block payment by itself', async () => {
    // Awaiting-dispense is the DISPENSING_PENDING blocker's business; the
    // charge is not finalisable yet, so pay() does not name it as unbilled.
    const ctx = createService('FINANCE_STAFF', {
      invoice: { patientResponsibilityAmount: 10, panelResponsibilityAmount: 0 },
      worklistPrescriptions: [
        { id: 'rx-1', quantity: 5, supplyMode: 'ONSITE_DISPENSE', status: 'ORDERED', item: { name: 'Amoxicillin' } },
      ],
    });
    await expect(withTenant(() => ctx.service.pay('inv-1', { paymentMethod: 'CASH' }))).resolves.toMatchObject({
      status: 'PAID',
    });
  });
});

// ===========================================================================
// §36 — A DEPOSIT TAKEN AT BOOKING IS NOT A SECOND SALE.
//
// If the visit came from an appointment whose booking fee was paid, that money
// is already in the clinic's hands. Recorded here as an amount the PATIENT HAS
// PAID, so the counter asks for the balance and not for the whole bill, and
// the deposit is not counted twice — once as a booking fee, again as invoice
// revenue.
// ===========================================================================

describe('the booking deposit is applied to the clinic invoice', () => {
  const depositOn = (ctx: ReturnType<typeof createService>, appointment: unknown) => {
    (ctx.tx.appointment.findFirst as jest.Mock).mockResolvedValue(appointment);
    return ctx;
  };

  it('100. a paid deposit reduces what the patient still owes', async () => {
    const ctx = depositOn(createService('FINANCE_STAFF'), {
      id: 'appt-1',
      bookingFeeAmount: 30,
    });

    await withTenant(() => ctx.service.create({ visitId: 'visit-1', createdByStaffId: 'staff-1' }));

    expect(ctx.tx.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { patientPaidAmount: 30 } }),
    );
  });

  it('101. the link is written on the APPOINTMENT, so it cannot be applied twice', async () => {
    // The column is single valued and the lookup filters on it being null, so
    // a second invoice for the same visit finds nothing to apply.
    const ctx = depositOn(createService('FINANCE_STAFF'), {
      id: 'appt-1',
      bookingFeeAmount: 30,
    });

    await withTenant(() => ctx.service.create({ visitId: 'visit-1', createdByStaffId: 'staff-1' }));

    expect(ctx.tx.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'appt-1' } }),
    );
    const lookup = (ctx.tx.appointment.findFirst as jest.Mock).mock.calls[0][0];
    expect(lookup.where.depositInvoiceId).toBeNull();
    expect(lookup.where.bookingFeePaidAt).toEqual({ not: null });
  });

  it('102. it is recorded in the appointment’s history', async () => {
    const ctx = depositOn(createService('FINANCE_STAFF'), {
      id: 'appt-1',
      bookingFeeAmount: 30,
    });

    await withTenant(() => ctx.service.create({ visitId: 'visit-1', createdByStaffId: 'staff-1' }));

    expect(ctx.tx.appointmentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'PAYMENT_CHANGED' }),
      }),
    );
  });

  it('103. a ZERO deposit changes nothing — most consultations carry no fee', async () => {
    const ctx = depositOn(createService('FINANCE_STAFF'), {
      id: 'appt-1',
      bookingFeeAmount: 0,
    });

    await withTenant(() => ctx.service.create({ visitId: 'visit-1', createdByStaffId: 'staff-1' }));

    expect(ctx.tx.appointment.update).not.toHaveBeenCalled();
  });

  it('104. a WALK-IN visit has no appointment and bills normally', async () => {
    const ctx = createService('FINANCE_STAFF');

    await expect(
      withTenant(() => ctx.service.create({ visitId: 'visit-1', createdByStaffId: 'staff-1' })),
    ).resolves.toBeDefined();
    expect(ctx.tx.appointment.update).not.toHaveBeenCalled();
  });
});
