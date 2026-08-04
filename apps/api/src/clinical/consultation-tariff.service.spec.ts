import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ConsultationTariffService } from './consultation-tariff.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';
import { UpsertConsultationTariffRuleDto } from './dto/upsert-consultation-tariff-rule.dto';

// ===========================================================================
// G4.5d3c-3b2 (D-094) — CONSULTATION TARIFF CONFIGURATION.
//
// Configuring what the clinic charges is financial-tier work; the rule
// selects a SERVICE and never carries a price of its own; and every
// combination the matcher could not act on is refused at configuration time
// rather than discovered at the counter.
// ===========================================================================

const VALID: UpsertConsultationTariffRuleDto = {
  clinicId: 'clinic-1',
  name: 'Day consultation',
  classification: 'CONSULTATION',
  startTime: '08:00',
  endTime: '22:59',
  serviceCatalogId: 'svc-day',
};

function build(role = 'OWNER_ADMIN', overrides: Record<string, unknown> = {}) {
  const prisma = {
    consultationTariffRule: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'rule-1', clinicId: 'clinic-1' }),
      create: jest.fn(async ({ data }: { data: object }) => ({ id: 'rule-new', ...data })),
      update: jest.fn(async ({ data }: { data: object }) => ({ id: 'rule-1', ...data })),
    },
    clinic: { findUnique: jest.fn().mockResolvedValue({ id: 'clinic-1' }) },
    serviceCatalog: { findUnique: jest.fn().mockResolvedValue({ id: 'svc-day', active: true }) },
    ...overrides,
  } as unknown as TenantScopedPrismaClient;

  const tx = {
    $executeRaw: jest.fn(),
    staff: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'staff-1', fullName: 'Faiz Finance', role, active: true, clinicId: 'clinic-1', userId: 'user-1',
      }),
    },
    clinic: { count: jest.fn().mockResolvedValue(1) },
    userClinicAccess: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const rawPrisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;
  return { service: new ConsultationTariffService(prisma, rawPrisma), prisma, tx };
}

const withTenant = <T,>(fn: () => Promise<T>) =>
  tenantContextStorage.run({ tenantId: 'test-tenant', staffId: 'staff-1' }, fn);

describe('consultation tariff configuration', () => {
  it.each([
    ['OWNER_ADMIN', true],
    ['FINANCE_STAFF', true],
    ['FRONT_DESK_CLINICAL_STAFF', false],
    ['DOCTOR_RESIDENT', false],
    ['STOCK_STAFF', false],
  ])('%s %s configure a consultation tariff', async (role, permitted) => {
    const { service } = build(role);
    const run = () => withTenant(() => service.create({ ...VALID }));
    if (permitted) {
      await expect(run()).resolves.toMatchObject({ name: 'Day consultation' });
    } else {
      await expect(run()).rejects.toThrow(ForbiddenException);
    }
  });

  it('45/47. a rule carries NO price — the service and the resolver decide', async () => {
    const { service, prisma } = build();
    await withTenant(() => service.create({ ...VALID }));
    const created = (prisma.consultationTariffRule.create as jest.Mock).mock.calls[0][0].data;
    expect(created).toMatchObject({ serviceCatalogId: 'svc-day', classification: 'CONSULTATION' });
    expect(Object.keys(created)).not.toContain('price');
    expect(Object.keys(created)).not.toContain('panelPrice');
  });

  it('38. a midnight-crossing band is accepted as configuration', async () => {
    const { service } = build();
    await expect(
      withTenant(() => service.create({ ...VALID, name: 'Night', startTime: '23:00', endTime: '07:59' })),
    ).resolves.toBeDefined();
  });

  it.each([
    ['a malformed time', { startTime: '8am' }],
    ['an out-of-range hour', { startTime: '24:00' }],
    ['identical start and end', { startTime: '08:00', endTime: '08:00' }],
  ])('refuses %s', async (_n, patch) => {
    const { service } = build();
    await expect(withTenant(() => service.create({ ...VALID, ...patch }))).rejects.toThrow(BadRequestException);
  });

  it('refuses an inverted effective window', async () => {
    const { service } = build();
    await expect(
      withTenant(() =>
        service.create({ ...VALID, effectiveFrom: '2026-06-01T00:00:00Z', effectiveTo: '2026-01-01T00:00:00Z' }),
      ),
    ).rejects.toThrow(/effective-from date cannot be after/i);
  });

  it('refuses an inactive or missing consultation service', async () => {
    const inactive = build('OWNER_ADMIN', {
      serviceCatalog: { findUnique: jest.fn().mockResolvedValue({ id: 'svc-day', active: false }) },
    });
    await expect(withTenant(() => inactive.service.create({ ...VALID }))).rejects.toThrow(/inactive/i);

    const missing = build('OWNER_ADMIN', {
      serviceCatalog: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(withTenant(() => missing.service.create({ ...VALID }))).rejects.toThrow(NotFoundException);
  });

  it('refuses configuration for a branch the actor is not authorised for', async () => {
    const { service, tx } = build();
    tx.clinic.count.mockResolvedValue(2); // multi-branch tenant
    await expect(withTenant(() => service.create({ ...VALID, clinicId: 'clinic-OTHER' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('deactivates rather than deletes — the charges it produced keep their provenance', async () => {
    const { service, prisma } = build();
    await withTenant(() => service.deactivate('rule-1'));
    expect(prisma.consultationTariffRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-1' },
      data: { active: false },
    });
  });

  it('the DTO refuses a rule with no service or no classification', () => {
    const invalid = plainToInstance(UpsertConsultationTariffRuleDto, {
      clinicId: '00000000-0000-4000-8000-000000000001',
      name: 'X',
      startTime: '08:00',
      endTime: '09:00',
    });
    const errors = validateSync(invalid).map((e) => e.property);
    expect(errors).toEqual(expect.arrayContaining(['classification', 'serviceCatalogId']));
  });
});
