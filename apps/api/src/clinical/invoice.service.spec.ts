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
      // Serves both the branch check ({clinicId}) and the benefit snapshot.
      findUnique: jest.fn(async ({ select }: { select?: Record<string, unknown> }) =>
        select?.clinicId && !select?.panelClinicId ? { clinicId: 'clinic-1' } : visitState,
      ),
    },
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
      findMany: jest.fn(async () => lines),
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
      findUnique: jest.fn().mockResolvedValue({ itemId: 'item-1', item: { sellPrice: 10 } }),
    },
    orderService: {
      findUnique: jest.fn().mockResolvedValue({ serviceCatalogId: 'svc-1', serviceCatalog: { price: 30 } }),
    },
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
  };

  const MATRIX: [string, (keyof typeof ACTIONS)[]][] = [
    ['OWNER_ADMIN', ['create', 'addLine', 'pay', 'cancel', 'discount']],
    ['FINANCE_STAFF', ['create', 'addLine', 'pay', 'cancel', 'discount']],
    // 22. Front desk bills and collects but NEVER discounts (owner decision 5).
    ['FRONT_DESK_CLINICAL_STAFF', ['create', 'addLine', 'pay']],
    ['DOCTOR_RESIDENT', ['create', 'addLine']],
    ['DOCTOR_LOCUM', ['create', 'addLine']],
    ['HR_STAFF', []],
    ['STOCK_STAFF', []],
    ['PANEL_STAFF', []],
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
    ctx.tx.prescription.findUnique.mockResolvedValue(null);
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
    await withTenant(() => ctx.service.cancelLine('inv-1', 'line-2', {}));
    expect(ctx.invoiceState).toMatchObject({
      subtotalAmount: 100,
      totalAmount: 100,
      patientResponsibilityAmount: 100,
    });
  });

  it('an already-cancelled line cannot be cancelled again', async () => {
    const ctx = withLines();
    await withTenant(() => ctx.service.cancelLine('inv-1', 'line-2', {}));
    await expect(withTenant(() => ctx.service.cancelLine('inv-1', 'line-2', {}))).rejects.toThrow(/already cancelled/i);
  });

  it('a line not on this invoice is a 404', async () => {
    const ctx = withLines();
    await expect(withTenant(() => ctx.service.cancelLine('inv-1', 'missing', {}))).rejects.toThrow(NotFoundException);
  });

  it('cancellation is refused once the invoice is PAID', async () => {
    const ctx = createService('FINANCE_STAFF', {
      invoice: { status: InvoiceStatus.PAID },
      lines: [{ id: 'line-1', amount: 10, excludedFromPanel: false, cancelledAt: null, lineDiscountType: null, lineDiscountValue: null }],
    });
    await expect(withTenant(() => ctx.service.cancelLine('inv-1', 'line-1', {}))).rejects.toThrow(/status PAID/);
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
