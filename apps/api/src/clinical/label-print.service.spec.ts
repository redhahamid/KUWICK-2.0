import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrescriptionStatus, PrescriptionSupplyMode, Role, Staff } from '@prisma/client';
import { LabelPrintService, MAX_LABEL_COPIES, assertLabelEligible } from './label-print.service';
import { PrismaService } from '../core/prisma.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// G4.5d5b-2 — LABELS COME FROM THE RECORD
//
// The old path assembled a drug label in the browser from whatever the page
// was holding and left no audit at all. These tests pin the two properties
// that replace it: every field is read from the prescription, and printing is
// emphatically not dispensing.
// ===========================================================================

const TENANT = 'tenant-1';
const CLINIC = 'clinic-1';

const staff = (over: Partial<Staff> = {}) =>
  ({
    id: 'staff-fd',
    tenantId: TENANT,
    userId: 'user-1',
    role: 'FRONT_DESK_CLINICAL_STAFF' as Role,
    fullName: 'Siti Aminah',
    active: true,
    clinicId: CLINIC,
    ...over,
  }) as Staff;

function build(
  actor: Staff | null = staff(),
  world: {
    status?: PrescriptionStatus;
    supplyMode?: PrescriptionSupplyMode | null;
    existingPrints?: number;
    dispensedByStaffId?: string | null;
    strengthMg?: number | null;
  } = {},
) {
  const {
    status = PrescriptionStatus.ORDERED,
    supplyMode = PrescriptionSupplyMode.ONSITE_DISPENSE,
    existingPrints = 0,
    dispensedByStaffId = null,
    strengthMg = 500,
  } = world;

  const prints: Record<string, unknown>[] = [];
  let printCount = existingPrints;

  const prescription = {
    id: 'rx-1',
    visitId: 'visit-1',
    deletedAt: null,
    status,
    supplyMode,
    amount: '1',
    unit: 'capsule',
    frequency: 'TDS',
    durationDays: 5,
    quantity: 15,
    indication: 'Chest infection',
    remark: 'After food',
    dispensedByStaffId,
    item: { name: 'Amoxicillin 500mg', strengthMg },
    prescribedBy: { fullName: 'Dr Amira Rahman' },
    visit: {
      id: 'visit-1',
      clinicId: CLINIC,
      visitNumber: 'SV-2026-0042',
      patient: { name: 'Nurul Izzati binti Kamal', identifierValue: 'A1234567' },
      clinic: { name: 'Smoke Test Clinic' },
    },
  };

  const tx = {
    $executeRaw: jest.fn(),
    staff: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (actor && where.id === actor.id) return actor;
        if (where.id === 'staff-dispenser') return { fullName: 'Nurul Huda' };
        return null;
      }),
    },
    clinic: { count: jest.fn(async () => 1) },
    userClinicAccess: { findMany: jest.fn(async () => []) },
    visit: { findUnique: jest.fn(async () => ({ id: 'visit-1', clinicId: CLINIC })) },
    prescription: { findUnique: jest.fn(async () => prescription) },
    labelPrint: {
      count: jest.fn(async () => printCount),
      create: jest.fn(async ({ data }: any) => {
        printCount += 1;
        const row = { ...data, id: `lp-${printCount}`, printedAt: new Date('2026-08-06T14:00:00Z') };
        prints.push(row);
        return row;
      }),
      findMany: jest.fn(async () => prints),
    },
    // Deliberately ABSENT: stockMovement, stockLevel, queueTicket, invoice.
    // If printing ever tried to touch one, this harness would throw rather
    // than quietly allow it.
  };

  const rawPrisma = { $transaction: jest.fn((fn: any) => fn(tx)) } as unknown as PrismaService;
  const service = new LabelPrintService({} as unknown as TenantScopedPrismaClient, rawPrisma);

  const run = <T>(fn: () => Promise<T>) =>
    tenantContextStorage.run({ tenantId: TENANT, staffId: actor?.id, userId: actor?.userId ?? undefined }, fn);

  return {
    tx,
    prints,
    print: (copies?: number) => run(() => service.print('rx-1', copies)),
    history: () => run(() => service.history('rx-1')),
  };
}

describe('the payload comes from the RECORD', () => {
  it('1. every clinical field is read from the prescription', async () => {
    const ctx = build();
    const label = await ctx.print();
    expect(label).toMatchObject({
      patient: { name: 'Nurul Izzati binti Kamal' },
      medication: {
        name: 'Amoxicillin 500mg',
        strength: '500mg',
        doseAmount: '1',
        doseUnit: 'capsule',
        frequency: 'TDS',
        durationDays: 5,
        quantity: 15,
        indication: 'Chest infection',
      },
      prescriber: 'Dr Amira Rahman',
      visitReference: 'SV-2026-0042',
    });
  });

  it('2. the clinic identity comes from the clinic record', async () => {
    const ctx = build();
    const label = await ctx.print();
    expect(label.clinic.name).toBe('Smoke Test Clinic');
  });

  it('3. who printed it is the AUTHENTICATED actor, not a request field', async () => {
    const ctx = build(staff({ fullName: 'Faiz Rahman' }));
    const label = await ctx.print();
    expect(label.processedBy).toBe('Faiz Rahman');
  });

  it('4. the dispenser appears only once the medication has been handed over', async () => {
    expect((await build().print()).dispensedBy).toBeNull();
    const dispensed = build(staff(), {
      status: PrescriptionStatus.DISPENSED,
      dispensedByStaffId: 'staff-dispenser',
    });
    expect((await dispensed.print()).dispensedBy).toBe('Nurul Huda');
  });

  it('5. a strength the item does not carry is OMITTED, not invented', async () => {
    const ctx = build(staff(), { strengthMg: null });
    expect((await ctx.print()).medication.strength).toBeNull();
  });

  it('6. nothing the schema cannot support appears on the label', async () => {
    const label = await build().print();
    // Generic name, dosage form, route, structured warnings, barcode: none of
    // these are reliably stored, and a wrong route on a medication label is a
    // patient-safety defect rather than a cosmetic gap.
    const keys = Object.keys(label.medication);
    expect(keys).not.toContain('genericName');
    expect(keys).not.toContain('route');
    expect(keys).not.toContain('dosageForm');
    expect(keys).not.toContain('barcode');
  });
});

describe('printing is audited', () => {
  it('7. the first print writes an audit row', async () => {
    const ctx = build();
    await ctx.print();
    expect(ctx.prints).toHaveLength(1);
    expect(ctx.prints[0]).toMatchObject({
      prescriptionId: 'rx-1',
      printedByStaffId: 'staff-fd',
      printerNameSnapshot: 'Siti Aminah',
      printSequence: 1,
      isReprint: false,
    });
  });

  it('8. a second print is recorded as a reprint', async () => {
    const ctx = build(staff(), { existingPrints: 1 });
    const label = await ctx.print();
    expect(label.isReprint).toBe(true);
    expect(label.printSequence).toBe(2);
    expect(ctx.prints[0]).toMatchObject({ isReprint: true, printSequence: 2 });
  });

  it('9. the copy count is recorded', async () => {
    const ctx = build();
    await ctx.print(3);
    expect(ctx.prints[0]).toMatchObject({ copies: 3 });
  });

  it('10. copies are bounded', async () => {
    await expect(build().print(0)).rejects.toThrow(BadRequestException);
    await expect(build().print(MAX_LABEL_COPIES + 1)).rejects.toThrow(BadRequestException);
    await expect(build().print(1.5)).rejects.toThrow(BadRequestException);
  });

  it('11. the history names who printed and when', async () => {
    const ctx = build();
    await ctx.print(2);
    const history = await ctx.history();
    expect(history[0]).toMatchObject({ printedByName: 'Siti Aminah', copies: 2, printSequence: 1 });
  });

  it('12. the format used is recorded, so a size change is traceable', async () => {
    const ctx = build();
    const label = await ctx.print();
    expect(label.labelFormat).toBe('KUWICK_STD_70x40');
    expect(ctx.prints[0]).toMatchObject({ labelFormat: 'KUWICK_STD_70x40' });
  });
});

describe('printing is NOT dispensing', () => {
  it('13. no stock client is reachable from this path at all', async () => {
    const ctx = build();
    await ctx.print();
    // Structural: the harness has no stock or queue clients, so any attempt
    // to touch one would have thrown rather than silently succeeded.
    expect((ctx.tx as Record<string, unknown>).stockMovement).toBeUndefined();
    expect((ctx.tx as Record<string, unknown>).stockLevel).toBeUndefined();
    expect((ctx.tx as Record<string, unknown>).queueTicket).toBeUndefined();
    expect((ctx.tx as Record<string, unknown>).invoice).toBeUndefined();
  });

  it('14. the prescription is READ, never written', async () => {
    const ctx = build();
    await ctx.print();
    expect((ctx.tx.prescription as Record<string, unknown>).update).toBeUndefined();
    expect((ctx.tx.prescription as Record<string, unknown>).updateMany).toBeUndefined();
  });

  it('15. an ORDERED prescription is still ORDERED after printing', async () => {
    const ctx = build();
    const label = await ctx.print();
    expect(label.dispensedBy).toBeNull();
  });
});

describe('label eligibility', () => {
  it('16. a cancelled prescription cannot print an operational label', () => {
    expect(() =>
      assertLabelEligible(PrescriptionStatus.CANCELLED, PrescriptionSupplyMode.ONSITE_DISPENSE),
    ).toThrow(/cancelled/i);
  });

  it.each([
    ['17. an external prescription', PrescriptionSupplyMode.EXTERNAL_PRESCRIPTION],
    ["18. the patient's own supply", PrescriptionSupplyMode.PATIENT_OWN_SUPPLY],
    ['19. no supply required', PrescriptionSupplyMode.NO_SUPPLY_REQUIRED],
  ])('%s cannot print a clinic label', (_name, supplyMode) => {
    expect(() => assertLabelEligible(PrescriptionStatus.ORDERED, supplyMode)).toThrow(
      /only to medication the clinic supplies/i,
    );
  });

  it('20. a deferred supply mode cannot print', () => {
    expect(() =>
      assertLabelEligible(PrescriptionStatus.ORDERED, PrescriptionSupplyMode.DEFERRED),
    ).toThrow(/deferred/i);
  });

  it('21. an unresolved supply mode cannot print', () => {
    expect(() => assertLabelEligible(PrescriptionStatus.ORDERED, null)).toThrow(/not been confirmed/i);
  });

  it('22. clinic-supplied medication may print, ordered or dispensed', () => {
    expect(() =>
      assertLabelEligible(PrescriptionStatus.ORDERED, PrescriptionSupplyMode.ONSITE_DISPENSE),
    ).not.toThrow();
    expect(() =>
      assertLabelEligible(PrescriptionStatus.DISPENSED, PrescriptionSupplyMode.ONSITE_DISPENSE),
    ).not.toThrow();
  });

  it('23. the service refuses an ineligible prescription end to end', async () => {
    const ctx = build(staff(), { supplyMode: PrescriptionSupplyMode.EXTERNAL_PRESCRIPTION });
    await expect(ctx.print()).rejects.toThrow(BadRequestException);
    expect(ctx.prints).toHaveLength(0);
  });

  it('24. no eligibility message leaks an enum value', () => {
    for (const mode of [
      PrescriptionSupplyMode.EXTERNAL_PRESCRIPTION,
      PrescriptionSupplyMode.DEFERRED,
      null,
    ]) {
      try {
        assertLabelEligible(PrescriptionStatus.ORDERED, mode);
      } catch (error) {
        expect((error as Error).message).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
      }
    }
  });
});

describe('permission and tenancy', () => {
  it.each([['STOCK_STAFF'], ['FINANCE_STAFF']] as const)('25. %s cannot print', async (role) => {
    const ctx = build(staff({ role: role as Role }));
    await expect(ctx.print()).rejects.toThrow(ForbiddenException);
    expect(ctx.prints).toHaveLength(0);
  });

  it('26. an inactive account cannot print', async () => {
    const ctx = build(staff({ active: false }));
    await expect(ctx.print()).rejects.toThrow();
  });

  it('27. a doctor may print', async () => {
    const ctx = build(staff({ role: 'DOCTOR_RESIDENT' as Role }));
    await expect(ctx.print()).resolves.toBeDefined();
  });

  it('28. no audit row is written when the print is refused', async () => {
    const ctx = build(staff({ role: 'FINANCE_STAFF' as Role }));
    await expect(ctx.print()).rejects.toThrow();
    expect(ctx.tx.labelPrint.create).not.toHaveBeenCalled();
  });
});
