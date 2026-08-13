import { BadRequestException } from '@nestjs/common';
import { PrescriptionService } from './prescription.service';
import { VisitService } from './visit.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// b1 PHASE A — THE BROWSER SENDS IDS; THE SERVER DECIDES WHAT THE ROW SAYS.
//
// The claim under test is that the patient-facing Malay text on a prescription
// is looked up here and copied, never accepted from a client. A caller able to
// post `frequencyBm: "Sekali sehari"` beside `frequency: "TDS"` could print a
// label that contradicts the prescription, and nothing downstream would catch
// it — the label renderer trusts the record precisely because the record is
// composed here.
//
// Second claim: the course is converted here. "2 WEEK" is 14 days once.
// ===========================================================================

const TENANT = 'test-tenant';
const OTHER = 'another-clinic';

const FREQ = '11111111-1111-4111-8111-111111111111';
const UNIT = '22222222-2222-4222-8222-222222222222';
const METHOD = '33333333-3333-4333-8333-333333333333';
const INDICATION = '44444444-4444-4444-8444-444444444444';

const TDS = { id: FREQ, tenantId: TENANT, active: true, code: 'TDS', patientLabelBm: 'Tiga kali sehari', timesPerDay: 3 };
const TABLET = { id: UNIT, tenantId: TENANT, active: true, systemNameEn: 'Tablet', patientLabelBm: 'BIJI' };
const ORAL = { id: METHOD, tenantId: TENANT, active: true, methodBilingual: 'ORAL (MAKAN/MINUM)', patientInstructionBm: 'Ambil melalui mulut' };
const FEVER = { id: INDICATION, tenantId: TENANT, active: true, labelEn: 'Fever', labelBm: 'Demam' };

/**
 * The catalogue lookups behave as they do under RLS: `findFirst` matches only
 * rows of the tenant named in the where clause, and only active ones.
 */
function createService(rows: Array<Record<string, unknown>> = [TDS, TABLET, ORAL, FEVER]) {
  const table = () => ({
    findFirst: jest.fn(async (args: { where: { id: string; tenantId: string; active: boolean } }) =>
      rows.find(
        (row) =>
          row.id === args.where.id && row.tenantId === args.where.tenantId && row.active === args.where.active,
      ) ?? null,
    ),
  });
  const prisma = {
    item: { findUnique: jest.fn().mockResolvedValue({ id: 'item-1', name: 'PCM', ageDosages: [] }) },
    prescription: { create: jest.fn(async (args: { data: unknown }) => args.data) },
    prescriptionFrequency: table(),
    dosageUnit: table(),
    consumptionMethodRef: table(),
    indicationPreset: table(),
    staff: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'dr-1', fullName: 'Dr Test', role: 'DOCTOR_RESIDENT', active: true,
      }),
    },
  } as unknown as TenantScopedPrismaClient;
  const visits = { findById: jest.fn().mockResolvedValue({ id: 'visit-1', staffId: 'dr-1' }) } as unknown as VisitService;
  return { service: new PrescriptionService(prisma, visits, {} as never), prisma };
}

const withTenant = <T>(fn: () => Promise<T>): Promise<T> =>
  tenantContextStorage.run({ tenantId: TENANT, staffId: 'dr-1' }, fn);

const BASE = { visitId: 'visit-1', itemId: 'item-1', quantity: 30, amount: 2, frequency: '', durationDays: 1 };

const written = (prisma: TenantScopedPrismaClient) =>
  ((prisma.prescription.create as unknown as jest.Mock).mock.calls[0][0] as { data: Record<string, unknown> }).data;

describe('the chosen catalogue entries are copied onto the prescription', () => {
  it('stores the doctor\'s word and the patient\'s word for every choice', async () => {
    const { service, prisma } = createService();
    await withTenant(() =>
      service.create({
        ...BASE,
        frequencyId: FREQ,
        doseUnitId: UNIT,
        consumptionMethodId: METHOD,
        indicationId: INDICATION,
        durationValue: 5,
        durationUnit: 'DAY',
      }),
    );
    expect(written(prisma)).toMatchObject({
      frequency: 'TDS',
      frequencyBm: 'Tiga kali sehari',
      unit: 'Tablet',
      doseUnitBm: 'BIJI',
      consumptionMethod: 'ORAL (MAKAN/MINUM)',
      consumptionInstructionBm: 'Ambil melalui mulut',
      indication: 'Fever',
      indicationBm: 'Demam',
    });
  });

  it('the resolved value WINS over free text sent alongside it', async () => {
    // Otherwise a client could store a frequency code that disagrees with the
    // Malay label printed beside it on the sticker.
    const { service, prisma } = createService();
    await withTenant(() => service.create({ ...BASE, frequency: 'OD', frequencyId: FREQ }));
    expect(written(prisma).frequency).toBe('TDS');
    expect(written(prisma).frequencyBm).toBe('Tiga kali sehari');
  });

  it('leaves free text alone when no catalogue entry was chosen', async () => {
    // Flow and Copy Rx write prescriptions without the dropdowns, and both
    // must keep working — with an honest NULL where the Malay label would be.
    const { service, prisma } = createService();
    await withTenant(() => service.create({ ...BASE, frequency: 'BD', unit: 'ml' }));
    expect(written(prisma)).toMatchObject({ frequency: 'BD', unit: 'ml' });
    expect(written(prisma).frequencyBm).toBeUndefined();
    expect(written(prisma).doseUnitBm).toBeUndefined();
  });
});

describe('the course is converted server-side', () => {
  it.each([
    [2, 'WEEK' as const, 14],
    [1, 'MONTH' as const, 30],
    [5, 'DAY' as const, 5],
  ])('%s %s is stored as %s days', async (value, unit, days) => {
    const { service, prisma } = createService();
    await withTenant(() =>
      // `durationDays` is deliberately WRONG here: if the client's arithmetic
      // were trusted, this would store 1.
      service.create({ ...BASE, durationDays: 1, durationValue: value, durationUnit: unit }),
    );
    expect(written(prisma)).toMatchObject({ durationDays: days, durationValue: value, durationUnit: unit });
  });

  it('keeps the submitted days when no value+unit pair was sent', async () => {
    const { service, prisma } = createService();
    await withTenant(() => service.create({ ...BASE, durationDays: 7 }));
    expect(written(prisma).durationDays).toBe(7);
  });
});

describe('an entry this clinic cannot use is refused before anything is written', () => {
  it('refuses another clinic\'s frequency', async () => {
    // The foreign key would accept it: PostgreSQL checks FKs through internal
    // triggers that RLS does not apply to. The prescription would then print
    // with no frequency and no error anywhere.
    const { service, prisma } = createService([{ ...TDS, tenantId: OTHER }]);
    await expect(withTenant(() => service.create({ ...BASE, frequencyId: FREQ }))).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.prescription.create).not.toHaveBeenCalled();
  });

  it('refuses a RETIRED entry', async () => {
    const { service } = createService([{ ...ORAL, active: false }]);
    await expect(
      withTenant(() => service.create({ ...BASE, consumptionMethodId: METHOD })),
    ).rejects.toThrow(/no longer on this clinic's list/);
  });

  it('names every stale choice at once', async () => {
    const { service } = createService([]);
    await expect(
      withTenant(() => service.create({ ...BASE, frequencyId: FREQ, doseUnitId: UNIT })),
    ).rejects.toThrow(/Frequency and Dose unit/);
  });

  it('does not look up what was not sent', async () => {
    const { service, prisma } = createService();
    await withTenant(() => service.create({ ...BASE, frequency: 'OD' }));
    expect(prisma.prescriptionFrequency.findFirst).not.toHaveBeenCalled();
    expect(prisma.indicationPreset.findFirst).not.toHaveBeenCalled();
  });
});
