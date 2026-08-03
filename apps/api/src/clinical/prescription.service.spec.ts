import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DosageCalcMethod, PrescriptionStatus, StockMovementType } from '@prisma/client';
import { PrescriptionService } from './prescription.service';
import { VisitService } from './visit.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    item: { findUnique: jest.fn() },
    prescription: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
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

  describe('dispense', () => {
    it('writes a DISPENSED stock movement, decrements StockLevel, and marks the prescription DISPENSED', async () => {
      const { service, prisma, visits } = createService();
      (prisma.prescription.findUnique as jest.Mock).mockResolvedValue({
        id: 'rx-1',
        visitId: 'visit-1',
        itemId: 'item-1',
        quantity: 3,
        status: PrescriptionStatus.ORDERED,
        deletedAt: null,
      });
      (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', clinicId: 'clinic-1' });
      (prisma.prescription.update as jest.Mock).mockResolvedValue({ id: 'rx-1', status: PrescriptionStatus.DISPENSED });

      await withTenant(() => service.dispense('rx-1'));

      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'test-tenant',
          clinicId: 'clinic-1',
          itemId: 'item-1',
          movementType: StockMovementType.DISPENSED,
          quantityDelta: -3,
          referenceType: 'Prescription',
          referenceId: 'rx-1',
        },
      });
      expect(prisma.stockLevel.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { quantityOnHand: { decrement: 3 } } }),
      );
      expect(prisma.prescription.update).toHaveBeenCalledWith({
        where: { id: 'rx-1' },
        data: { status: PrescriptionStatus.DISPENSED, dispensedAt: expect.any(Date) },
      });
    });

    it('rejects dispensing a prescription that is not ORDERED', async () => {
      const { service, prisma } = createService();
      (prisma.prescription.findUnique as jest.Mock).mockResolvedValue({
        id: 'rx-1',
        status: PrescriptionStatus.CANCELLED,
        deletedAt: null,
      });

      await expect(service.dispense('rx-1')).rejects.toThrow(BadRequestException);
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
      const ctx = buildSupply(DOCTOR);
      await runSupply(ctx);
      const data = (ctx.tx.prescription.update as jest.Mock).mock.calls[0][0].data;
      expect(Object.keys(data)).toEqual(['supplyMode']);
    });
  });
});
