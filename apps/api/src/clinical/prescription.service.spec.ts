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
  } as unknown as TenantScopedPrismaClient;
  const visits = { findById: jest.fn() } as unknown as VisitService;
  return { service: new PrescriptionService(prisma, visits), prisma, visits };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
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
          prescribedByStaffId: 'staff-1',
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
});
