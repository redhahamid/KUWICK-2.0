import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DosageCalcMethod, PrescriptionStatus, StockMovementType } from '@prisma/client';
import { PrescriptionService } from './prescription.service';
import { VisitService } from './visit.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    item: { findUnique: jest.fn() },
    prescription: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    visit: { findMany: jest.fn() },
    stockMovement: { create: jest.fn() },
    stockLevel: { upsert: jest.fn() },
    // D-085 — prescribing now resolves the AUTHOR from the session and
    // requires a role entitled to author clinical work.
    staff: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'dr-1', fullName: 'Dr Test', role: 'DOCTOR_RESIDENT', active: true,
      }),
    },
  } as unknown as TenantScopedPrismaClient;
  const visits = { findById: jest.fn() } as unknown as VisitService;
  const rawPrisma = { $transaction: jest.fn(async (fn: any) => fn({ ...(prisma as object), $executeRaw: jest.fn() })) } as never;
  return { service: new PrescriptionService(prisma, visits, rawPrisma), prisma, visits };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant', staffId: 'dr-1' }, fn);
}

describe('PrescriptionService', () => {
  describe('create', () => {
    it('recomputes the dose server-side for WEIGHT_BASED, ignoring the submitted amount', async () => {
      const { service, prisma, visits } = createService();
      (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'staff-1' });
      (prisma.item.findUnique as jest.Mock).mockResolvedValue({
        id: 'item-1',
        name: 'Augmentin',
        concVolMl: 5,
        strengthMg: 457,
        ageDosages: [],
      });
      (prisma.prescription.create as jest.Mock).mockResolvedValue({ id: 'rx-1' });

      // 10kg x 15mg/kg = 150mg; 150mg x 5mL / 457mg = 1.64mL — verified
      // against the live kuwick.com calculator (docs/DECISIONS.md D-028).
      await withTenant(() =>
        service.create({
          visitId: 'visit-1',
          itemId: 'item-1',
          quantity: 1,
          amount: 999, // deliberately wrong — must be overridden
          frequency: 'BD',
          durationDays: 5,
          calcMethod: DosageCalcMethod.WEIGHT_BASED,
          calcWeightKg: 10,
          calcDoseRateMgKg: 15,
        }),
      );

      expect(prisma.prescription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: 1.64,
          calcTargetDoseMg: 150,
          calcMethod: DosageCalcMethod.WEIGHT_BASED,
          prescribedByStaffId: 'dr-1',
        }),
      });
    });

    it('rejects WEIGHT_BASED when the item has no concVolMl/strengthMg configured', async () => {
      const { service, prisma, visits } = createService();
      (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'staff-1' });
      (prisma.item.findUnique as jest.Mock).mockResolvedValue({
        id: 'item-1',
        name: 'Paracetamol Tablet',
        concVolMl: null,
        strengthMg: null,
        ageDosages: [],
      });

      await expect(
        withTenant(() =>
          service.create({
            visitId: 'visit-1',
            itemId: 'item-1',
            quantity: 1,
            amount: 1,
            frequency: 'BD',
            durationDays: 5,
            calcMethod: DosageCalcMethod.WEIGHT_BASED,
            calcWeightKg: 10,
            calcDoseRateMgKg: 15,
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts AGE_BASED only when it matches a configured bracket', async () => {
      const { service, prisma, visits } = createService();
      (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'staff-1' });
      (prisma.item.findUnique as jest.Mock).mockResolvedValue({
        id: 'item-1',
        name: 'Cetirizine Syrup',
        concVolMl: null,
        strengthMg: null,
        ageDosages: [{ amount: 2.5, unit: 'ml', frequency: 'OD', ageFromMonths: 24, ageToMonths: 60 }],
      });

      await expect(
        withTenant(() =>
          service.create({
            visitId: 'visit-1',
            itemId: 'item-1',
            quantity: 1,
            amount: 5, // does not match the 2.5ml bracket above
            unit: 'ml',
            frequency: 'OD',
            durationDays: 5,
            calcMethod: DosageCalcMethod.AGE_BASED,
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('trusts MANUAL dosing as submitted', async () => {
      const { service, prisma, visits } = createService();
      (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'staff-1' });
      (prisma.item.findUnique as jest.Mock).mockResolvedValue({ id: 'item-1', name: 'Panadol', ageDosages: [] });
      (prisma.prescription.create as jest.Mock).mockResolvedValue({ id: 'rx-1' });

      await withTenant(() =>
        service.create({
          visitId: 'visit-1',
          itemId: 'item-1',
          quantity: 2,
          amount: 1,
          unit: 'tablet',
          frequency: 'TDS',
          durationDays: 3,
        }),
      );

      expect(prisma.prescription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ amount: 1, calcMethod: undefined, calcTargetDoseMg: undefined }),
      });
    });
  });

  describe('dispense (D-093 hardened)', () => {
    function buildDispense(world: { prescription?: Record<string, unknown> | null; claimCount?: number } = {}) {
      const {
        prescription = {
          id: 'rx-1', visitId: 'visit-1', itemId: 'item-1', quantity: 3,
          status: PrescriptionStatus.ORDERED, supplyMode: 'ONSITE_DISPENSE', deletedAt: null,
        },
        claimCount = 1,
      } = world;
      // The medicine every test here shares is DISPENSED WHOLE — divisor 1, so
      // dose units and stock units coincide and the pre-conversion assertions
      // still describe what they were written to describe. A test that cares
      // about the conversion passes its own `item`.
      const rx = prescription
        ? {
            item: {
              quantityPerStockUnit: 1,
              unitsPerPack: null,
              dispensedWholeAt: new Date('2026-01-01'),
            },
            ...prescription,
          }
        : null;
      const tx = {
        $executeRaw: jest.fn(),
        staff: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'staff-disp', fullName: 'Dina Dispenser', role: 'FRONT_DESK_CLINICAL_STAFF',
            active: true, userId: 'user-disp',
          }),
        },
        prescription: {
          findUnique: jest.fn(async () => rx),
          // The atomic claim: WHERE carries status ORDERED + ONSITE mode.
          updateMany: jest.fn().mockResolvedValue({ count: claimCount }),
        },
        visit: { findUnique: jest.fn().mockResolvedValue({ clinicId: 'clinic-1' }) },
        stockMovement: { create: jest.fn() },
        stockLevel: { upsert: jest.fn() },
      };
      const rawPrisma = { $transaction: jest.fn((fn: any) => fn(tx)) } as never;
      const service = new PrescriptionService({} as never, { findById: jest.fn() } as never, rawPrisma);
      return { service, tx };
    }
    const runDispense = (ctx: { service: PrescriptionService }) => withTenant(() => ctx.service.dispense('rx-1'));

    it('31/34. dispensing claims atomically, moves stock once, and records the dispenser', async () => {
      const ctx = buildDispense();
      await runDispense(ctx);

      const claim = (ctx.tx.prescription.updateMany as jest.Mock).mock.calls[0][0];
      // The precondition lives in the WHERE clause — the D-087 pattern. Two
      // concurrent calls contend on the row; exactly one sees count 1.
      expect(claim.where).toMatchObject({
        id: 'rx-1',
        status: PrescriptionStatus.ORDERED,
        supplyMode: 'ONSITE_DISPENSE',
      });
      expect(claim.data).toMatchObject({
        status: PrescriptionStatus.DISPENSED,
        dispensedByStaffId: 'staff-disp',
      });

      expect(ctx.tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          movementType: StockMovementType.DISPENSED,
          quantityDelta: -3,
          referenceId: 'rx-1',
          // 34b. The ledger names who moved the stock.
          createdByUserId: 'user-disp',
        }),
      });
      expect(ctx.tx.stockLevel.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { quantityOnHand: { decrement: 3 } } }),
      );
    });

    it('33. a lost claim moves NO stock — the loser of a race cannot double-deduct', async () => {
      const ctx = buildDispense({ claimCount: 0 });
      await expect(runDispense(ctx)).rejects.toThrow(BadRequestException);
      expect(ctx.tx.stockMovement.create).not.toHaveBeenCalled();
      expect(ctx.tx.stockLevel.upsert).not.toHaveBeenCalled();
    });

    it.each(['EXTERNAL_PRESCRIPTION', 'PATIENT_OWN_SUPPLY', 'NO_SUPPLY_REQUIRED', 'DEFERRED', null])(
      '32. supply mode %s is refused at the server',
      async (mode) => {
        const ctx = buildDispense({
          prescription: {
            id: 'rx-1', visitId: 'visit-1', itemId: 'item-1', quantity: 3,
            status: PrescriptionStatus.ORDERED, supplyMode: mode, deletedAt: null,
          },
          claimCount: 0,
        });
        await expect(runDispense(ctx)).rejects.toThrow(/clinic dispensing/i);
        expect(ctx.tx.stockMovement.create).not.toHaveBeenCalled();
      },
    );

    it('an already-DISPENSED prescription says so rather than deducting again', async () => {
      const ctx = buildDispense({
        prescription: {
          id: 'rx-1', visitId: 'visit-1', itemId: 'item-1', quantity: 3,
          status: PrescriptionStatus.DISPENSED, supplyMode: 'ONSITE_DISPENSE', deletedAt: null,
        },
        claimCount: 0,
      });
      await expect(runDispense(ctx)).rejects.toThrow(/already been dispensed/i);
    });

    // ---------------------------------------------------------------------
    // A COURSE IS NOT A COUNT OF PACKS.
    //
    // `quantity` is 30 tablets; the shelf holds strips. This path deducted the
    // doctor's number straight into a level counted in the other unit.
    // ---------------------------------------------------------------------

    const STRIP = { quantityPerStockUnit: 10, unitsPerPack: null, dispensedWholeAt: null };
    const rxWith = (item: Record<string, unknown>, quantity = 30) => ({
      id: 'rx-1', visitId: 'visit-1', itemId: 'item-1', quantity, item,
      status: PrescriptionStatus.ORDERED, supplyMode: 'ONSITE_DISPENSE', deletedAt: null,
    });

    it('35. 30 tablets of a 10-per-strip medicine deducts 3 strips, not 30', async () => {
      const ctx = buildDispense({ prescription: rxWith(STRIP) });
      await runDispense(ctx);

      expect(ctx.tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ quantityDelta: -3, clinicalQuantity: 30 }),
      });
      expect(ctx.tx.stockLevel.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { quantityOnHand: { decrement: 3 } } }),
      );
    });

    it('36. a partial pack rounds UP — 25 tablets takes 3 strips', async () => {
      const ctx = buildDispense({ prescription: rxWith(STRIP, 25) });
      await runDispense(ctx);

      expect(ctx.tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ quantityDelta: -3 }),
      });
    });

    it('37. a PRN quantity somebody typed converts the same way', async () => {
      const ctx = buildDispense({ prescription: rxWith(STRIP, 12) });
      await runDispense(ctx);

      expect(ctx.tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ quantityDelta: -2, clinicalQuantity: 12 }),
      });
    });

    it('38. an item dispensed whole deducts one unit per prescribed unit', async () => {
      const ctx = buildDispense({ prescription: rxWith({ quantityPerStockUnit: 1, unitsPerPack: null, dispensedWholeAt: new Date('2026-01-01') }, 2) });
      await runDispense(ctx);

      expect(ctx.tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ quantityDelta: -2, clinicalQuantity: 2 }),
      });
    });

    it('39. no stated pack size is refused, not guessed at 1 — and nothing is claimed', async () => {
      // The check runs BEFORE the claim, so a refusal leaves the prescription
      // ORDERED rather than marked dispensed with no stock moved.
      const ctx = buildDispense({
        prescription: rxWith({ quantityPerStockUnit: null, unitsPerPack: null, dispensedWholeAt: null }),
      });

      await expect(runDispense(ctx)).rejects.toThrow(/no quantity per stock unit/i);
      expect(ctx.tx.prescription.updateMany).not.toHaveBeenCalled();
      expect(ctx.tx.stockMovement.create).not.toHaveBeenCalled();
      expect(ctx.tx.stockLevel.upsert).not.toHaveBeenCalled();
    });

    it("40. the import's pack size is used when the clinic has not stated one", async () => {
      const ctx = buildDispense({
        prescription: rxWith({ quantityPerStockUnit: null, unitsPerPack: 10, dispensedWholeAt: null }),
      });
      await runDispense(ctx);

      expect(ctx.tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ quantityDelta: -3 }),
      });
    });
  });

  describe('cancel', () => {
    it('rejects cancelling a prescription that is already DISPENSED', async () => {
      const { service, prisma } = createService();
      (prisma.prescription.findUnique as jest.Mock).mockResolvedValue({
        id: 'rx-1',
        status: PrescriptionStatus.DISPENSED,
        deletedAt: null,
      });

      await expect(service.cancel('rx-1', {})).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('soft-deletes only while still ORDERED', async () => {
      const { service, prisma } = createService();
      (prisma.prescription.findUnique as jest.Mock).mockResolvedValue({
        id: 'rx-1',
        status: PrescriptionStatus.DISPENSED,
        deletedAt: null,
      });

      await expect(service.remove('rx-1')).rejects.toThrow(BadRequestException);
    });

    it('is a no-op to future lookups once removed', async () => {
      const { service, prisma } = createService();
      (prisma.prescription.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'rx-1', status: PrescriptionStatus.ORDERED, deletedAt: null })
        .mockResolvedValueOnce({ id: 'rx-1', status: PrescriptionStatus.ORDERED, deletedAt: new Date() });

      await service.remove('rx-1');
      await expect(service.findById('rx-1')).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // G4.5d3c-3a1 (D-091) — SUPPLY MODE
  //
  // The intent is explicit at create (no hidden default), and changing it is
  // a clinical act under the same author gate as prescribing: front desk and
  // finance are refused at the server, not merely denied a control.
  // =========================================================================
  describe('supply mode', () => {
    const DOCTOR = { id: 'dr-1', fullName: 'Dr Test', role: 'DOCTOR_RESIDENT', active: true, clinicId: 'clinic-1', userId: 'u-1' };

    function buildSupply(actor: Record<string, unknown> | null, world: {
      prescription?: Record<string, unknown> | null;
      branchCount?: number;
    } = {}) {
      const {
        prescription = { id: 'rx-1', visitId: 'visit-1', status: PrescriptionStatus.ORDERED, deletedAt: null, supplyMode: null },
        branchCount = 1,
      } = world;
      const tx = {
        $executeRaw: jest.fn(),
        staff: { findUnique: jest.fn(async ({ where }: any) => (actor && where.id === actor.id ? actor : null)) },
        clinic: { count: jest.fn().mockResolvedValue(branchCount) },
        userClinicAccess: { findMany: jest.fn().mockResolvedValue([]) },
        visit: { findUnique: jest.fn().mockResolvedValue({ clinicId: 'clinic-1' }) },
        prescription: {
          findUnique: jest.fn().mockResolvedValue(prescription),
          update: jest.fn(async ({ data }: any) => ({ ...prescription, ...data })),
        },
      };
      const rawPrisma = { $transaction: jest.fn((fn: any) => fn(tx)) } as never;
      const service = new PrescriptionService({} as never, { findById: jest.fn() } as never, rawPrisma);
      return { service, tx, actorId: (actor?.id as string) ?? undefined };
    }

    const runSupply = (ctx: ReturnType<typeof buildSupply>, mode = 'EXTERNAL_PRESCRIPTION') =>
      tenantContextStorage.run({ tenantId: 'test-tenant', staffId: ctx.actorId } as never, () =>
        ctx.service.setSupplyMode('rx-1', { supplyMode: mode as never }),
      );

    it('1/2. create stores the submitted supply mode verbatim', async () => {
      const { service, prisma, visits } = createService();
      (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1' });
      (prisma.item.findUnique as jest.Mock).mockResolvedValue({ id: 'item-1', name: 'X', ageDosages: [] });
      (prisma.prescription.create as jest.Mock).mockResolvedValue({ id: 'rx-1' });
      await withTenant(() =>
        service.create({ visitId: 'visit-1', itemId: 'item-1', quantity: 1, amount: 1, frequency: 'OD', durationDays: 1, supplyMode: 'ONSITE_DISPENSE' as never }),
      );
      expect((prisma.prescription.create as jest.Mock).mock.calls[0][0].data.supplyMode).toBe('ONSITE_DISPENSE');
    });

    it('3. create without a supply mode stores NULL — no hidden server default', async () => {
      const { service, prisma, visits } = createService();
      (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1' });
      (prisma.item.findUnique as jest.Mock).mockResolvedValue({ id: 'item-1', name: 'X', ageDosages: [] });
      (prisma.prescription.create as jest.Mock).mockResolvedValue({ id: 'rx-1' });
      await withTenant(() =>
        service.create({ visitId: 'visit-1', itemId: 'item-1', quantity: 1, amount: 1, frequency: 'OD', durationDays: 1 }),
      );
      // undefined -> Prisma leaves the column NULL. Never ONSITE by silence.
      expect((prisma.prescription.create as jest.Mock).mock.calls[0][0].data.supplyMode).toBeUndefined();
    });

    it('5. a doctor can set every approved value', async () => {
      for (const mode of ['ONSITE_DISPENSE', 'EXTERNAL_PRESCRIPTION', 'PATIENT_OWN_SUPPLY', 'DEFERRED', 'NO_SUPPLY_REQUIRED']) {
        const ctx = buildSupply(DOCTOR);
        await expect(runSupply(ctx, mode)).resolves.toMatchObject({ supplyMode: mode });
      }
    });

    it.each([
      ['6. front desk', { id: 'fd-1', fullName: 'Amy', role: 'FRONT_DESK_CLINICAL_STAFF', active: true, clinicId: 'clinic-1', userId: 'u-f' }],
      ['7. finance', { id: 'fin-1', fullName: 'Faiz', role: 'FINANCE_STAFF', active: true, clinicId: 'clinic-1', userId: 'u-x' }],
    ])('%s cannot change a supply mode', async (_n, actor) => {
      const ctx = buildSupply(actor);
      await expect(runSupply(ctx)).rejects.toThrow(/not permitted/i);
      expect(ctx.tx.prescription.update).not.toHaveBeenCalled();
    });

    it('8. anonymous is denied', async () => {
      await expect(runSupply(buildSupply(null))).rejects.toThrow(/No authenticated staff/i);
    });

    it('9. an inactive doctor is denied', async () => {
      const ctx = buildSupply({ ...DOCTOR, active: false });
      await expect(runSupply(ctx)).rejects.toThrow(/inactive/i);
    });

    it('10. a foreign tenant row reads as the same 404 as a missing one', async () => {
      // RLS makes the row invisible; the service cannot tell and must not try.
      const ctx = buildSupply(DOCTOR, { prescription: null });
      await expect(runSupply(ctx)).rejects.toThrow(NotFoundException);
    });

    it('11. cross-branch access is denied', async () => {
      const ctx = buildSupply({ ...DOCTOR, clinicId: 'clinic-9' }, { branchCount: 2 });
      await expect(runSupply(ctx)).rejects.toThrow(/branch|not permitted|access/i);
      expect(ctx.tx.prescription.update).not.toHaveBeenCalled();
    });

    it('12. a DISPENSED prescription refuses the change, with a reason', async () => {
      const ctx = buildSupply(DOCTOR, {
        prescription: { id: 'rx-1', visitId: 'visit-1', status: PrescriptionStatus.DISPENSED, deletedAt: null },
      });
      await expect(runSupply(ctx)).rejects.toThrow(/already been dispensed/i);
    });

    it('13. a CANCELLED prescription cannot be edited', async () => {
      const ctx = buildSupply(DOCTOR, {
        prescription: { id: 'rx-1', visitId: 'visit-1', status: PrescriptionStatus.CANCELLED, deletedAt: null },
      });
      await expect(runSupply(ctx)).rejects.toThrow(/cancelled prescription cannot be edited/i);
    });

    it('a soft-deleted prescription is a 404', async () => {
      const ctx = buildSupply(DOCTOR, {
        prescription: { id: 'rx-1', visitId: 'visit-1', status: PrescriptionStatus.ORDERED, deletedAt: new Date() },
      });
      await expect(runSupply(ctx)).rejects.toThrow(NotFoundException);
    });

    it('authorship is never rewritten by a supply-mode change', async () => {
      // The point is the PRESCRIBER, not the key count: an edit must never
      // quietly re-author the prescription to whoever touched it last.
      const ctx = buildSupply(DOCTOR);
      await runSupply(ctx);
      const data = (ctx.tx.prescription.update as jest.Mock).mock.calls[0][0].data;
      expect(data).not.toHaveProperty('prescribedByStaffId');
      expect(data).not.toHaveProperty('prescribedAt');
      expect(data.supplyMode).toBeDefined();
    });

    it('KW2-C2 — editing a carried-over row clears its review flag, attributed', async () => {
      // Editing a copied medication IS reviewing it, so the edit clears the
      // flag rather than leaving a warning the doctor has already answered.
      const ctx = buildSupply(DOCTOR);
      await runSupply(ctx);
      const data = (ctx.tx.prescription.update as jest.Mock).mock.calls[0][0].data;
      expect(data.reviewFlag).toBe(false);
      expect(data.reviewedByStaffId).toBe(DOCTOR.id);
      expect(data.reviewedAt).toBeInstanceOf(Date);
    });
  });
});

// ===========================================================================
// KW2-C2 — COPY RX
//
// Copying a previous visit's medication is a NEW prescribing decision made
// from OLD information: the weight, the allergies and the stock have all had
// time to change. These tests hold the two properties that make that safe —
// only what was chosen is copied, and what was copied is marked as not yet
// re-read.
// ===========================================================================
describe('copyFromVisit (KW2-C2)', () => {
  const source = (id: string, itemId = 'item-1') => ({
    id,
    itemId,
    quantity: 1,
    amount: 5,
    unit: 'ml',
    frequency: 'TDS',
    durationDays: 5,
    indication: null,
    remark: null,
    supplyMode: 'ONSITE_DISPENSE',
  });

  const setup = (rows: ReturnType<typeof source>[]) => {
    const ctx = createService();
    (ctx.visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-today', clinicId: 'clinic-1' });
    (ctx.prisma.prescription.findMany as jest.Mock).mockResolvedValue(rows);
    (ctx.prisma.prescription.create as jest.Mock).mockImplementation(({ data }: never) =>
      Promise.resolve({ id: 'new', ...(data as object) }),
    );
    return ctx;
  };

  it('1. copies ONLY the medications that were selected', async () => {
    const ctx = setup([source('rx-1'), source('rx-2')]);
    await withTenant(() =>
      ctx.service.copyFromVisit({
        sourceVisitId: 'visit-old',
        targetVisitId: 'visit-today',
        prescriptionIds: ['rx-1', 'rx-2'],
      }),
    );
    const where = (ctx.prisma.prescription.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.id).toEqual({ in: ['rx-1', 'rx-2'] });
  });

  it('2. no selection still copies the whole visit — 1.0 depends on it', async () => {
    const ctx = setup([source('rx-1')]);
    await withTenant(() =>
      ctx.service.copyFromVisit({ sourceVisitId: 'visit-old', targetVisitId: 'visit-today' }),
    );
    const where = (ctx.prisma.prescription.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.id).toBeUndefined();
  });

  it('3. every copied row records WHERE it came from and that it needs re-reading', async () => {
    const ctx = setup([source('rx-1')]);
    await withTenant(() =>
      ctx.service.copyFromVisit({
        sourceVisitId: 'visit-old',
        targetVisitId: 'visit-today',
        prescriptionIds: ['rx-1'],
      }),
    );
    const data = (ctx.prisma.prescription.create as jest.Mock).mock.calls[0][0].data;
    expect(data.sourceVisitId).toBe('visit-old');
    expect(data.reviewFlag).toBe(true);
  });

  it('4. a selection that no longer matches is REFUSED, not silently trimmed', async () => {
    // Handing back fewer medications than were ticked, with nothing said, is
    // the failure mode this guards: the doctor believes three were carried
    // over and two were.
    const ctx = setup([source('rx-1')]);
    await expect(
      withTenant(() =>
        ctx.service.copyFromVisit({
          sourceVisitId: 'visit-old',
          targetVisitId: 'visit-today',
          prescriptionIds: ['rx-1', 'rx-cancelled'],
        }),
      ),
    ).rejects.toThrow(NotFoundException);
    expect(ctx.prisma.prescription.create).not.toHaveBeenCalled();
  });

  it('5. the copy is authored by whoever made it, not by the original prescriber', async () => {
    const ctx = setup([source('rx-1')]);
    await withTenant(() =>
      ctx.service.copyFromVisit({ sourceVisitId: 'visit-old', targetVisitId: 'visit-today' }),
    );
    expect((ctx.prisma.prescription.create as jest.Mock).mock.calls[0][0].data.prescribedByStaffId).toBe('dr-1');
  });
});

describe('markReviewed (KW2-C2)', () => {
  it('6. clears the flag as an ATOMIC claim, so a double-click writes once', async () => {
    const ctx = createService();
    (ctx.prisma.prescription.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (ctx.prisma.prescription.findFirst as jest.Mock).mockResolvedValue({ id: 'rx-1', reviewFlag: false });
    await withTenant(() => ctx.service.markReviewed('rx-1'));
    const call = (ctx.prisma.prescription.updateMany as jest.Mock).mock.calls[0][0];
    expect(call.where).toMatchObject({ id: 'rx-1', reviewFlag: true });
    // Attribution comes from the SESSION, never from the client.
    expect(call.data).toMatchObject({ reviewFlag: false, reviewedByStaffId: 'dr-1' });
    expect(call.data.reviewedAt).toBeInstanceOf(Date);
  });

  it('7. clearing an already-clear flag is a no-op, not an error', async () => {
    // The caller's intent — "this row no longer needs reviewing" — is
    // satisfied either way.
    const ctx = createService();
    (ctx.prisma.prescription.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    (ctx.prisma.prescription.findFirst as jest.Mock).mockResolvedValue({ id: 'rx-1', reviewFlag: false });
    await expect(withTenant(() => ctx.service.markReviewed('rx-1'))).resolves.toBeTruthy();
  });

  it('8. a prescription that does not exist is a 404', async () => {
    const ctx = createService();
    (ctx.prisma.prescription.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    (ctx.prisma.prescription.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(withTenant(() => ctx.service.markReviewed('nope'))).rejects.toThrow(NotFoundException);
  });
});
