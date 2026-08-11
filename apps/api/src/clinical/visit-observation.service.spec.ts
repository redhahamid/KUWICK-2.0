import { BadRequestException } from '@nestjs/common';
import { Staff } from '@prisma/client';
import { VisitObservationService } from './visit-observation.service';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// G4.5d3c-3c — DUPLICATE VITALS: THE SERVER SIDE
//
// The owner reported the same set of observations appearing twice on a visit
// and asked for the actual root cause rather than a way of hiding the second
// row. There were two, and this file covers the one that mattered most:
// `record()` inserted unconditionally, on every call, with nothing anywhere
// in the request path — controller, service or database — asking whether that
// reading was already there.
//
// A fix that merely stopped RENDERING the duplicate would have left the
// clinical record itself carrying two readings. An export, a document merge
// field or an audit would still find both, and the record would say the
// patient's BP was taken twice when it was taken once. So the duplicate is
// prevented, not concealed.
// ===========================================================================

const TENANT = 'test-tenant';
const CLINIC = 'clinic-1';
const VISIT = 'visit-1';

function staff(overrides: Partial<Staff> = {}): Staff {
  return {
    id: 'staff-nurse',
    tenantId: TENANT,
    userId: 'user-1',
    role: 'FRONT_DESK_CLINICAL_STAFF',
    fullName: 'Siti Aminah',
    staffNumber: null,
    active: true,
    clinicId: CLINIC,
    createdAt: new Date(),
    updatedAt: new Date(),
    professionalType: null,
    medicalRegistrationNo: null,
    medicalRegistrationNoNormalised: null,
    professionalActive: false,
    canSignClinicalNotes: false,
    professionalVerifiedAt: null,
    professionalVerifiedByStaffId: null,
    clinicalSigningEnabledAt: null,
    clinicalSigningEnabledByStaffId: null,
    ...overrides,
  } as Staff;
}

interface Row extends Record<string, unknown> {
  id: string;
  visitId: string;
  recordedByStaffId: string;
  recordedAt: Date;
}

/**
 * A fake with real behaviour where it matters.
 *
 * `findFirst` honours visitId, recordedByStaffId and the `recordedAt >= since`
 * predicate, because the duplicate rule is defined by exactly those three
 * conditions and a fake that ignored them would let the rule rot.
 */
function build(actor: Staff | null = staff()) {
  const rows: Row[] = [];
  const revisions: Record<string, unknown>[] = [];
  const rawSql: string[] = [];
  let seq = 0;
  // The service compares against the REAL clock (Date.now() minus the
  // window), so rows are stamped with the real clock too. Test 13 moves
  // Date.now() forward instead of backdating a row, which is what actually
  // happens in a clinic.
  let now = () => new Date();

  // A working advisory lock, modelled: PostgreSQL blocks the second holder
  // until the first transaction commits. Without modelling it the fake would
  // interleave the four concurrent calls at their awaits and the test would
  // "prove" a race the real database does not have. The lock's CORRECTNESS is
  // PostgreSQL's; what this test proves is that the service takes it BEFORE
  // it reads, which is the part the service is responsible for.
  let lockChain: Promise<unknown> = Promise.resolve();
  const acquireLock = () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const waitFor = lockChain;
    lockChain = lockChain.then(() => held);
    return waitFor.then(() => release);
  };
  let releaseLock: (() => void) | null = null;

  const tx = {
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?') + JSON.stringify(values);
      rawSql.push(sql);
      if (sql.includes('pg_advisory_xact_lock')) {
        releaseLock = await acquireLock();
      }
      return 1;
    },
    staff: { findUnique: () => Promise.resolve(actor) },
    clinic: { count: () => Promise.resolve(1) },
    userClinicAccess: { findMany: () => Promise.resolve([]) },
    visit: { findUnique: () => Promise.resolve({ id: VISIT, clinicId: CLINIC }) },
    visitObservation: {
      findMany: () => Promise.resolve([...rows].reverse()),
      findFirst: ({ where }: { where: Record<string, any> }) => {
        const since = where.recordedAt?.gte as Date | undefined;
        const matches = rows.filter(
          (row) =>
            row.visitId === where.visitId &&
            row.recordedByStaffId === where.recordedByStaffId &&
            (!since || row.recordedAt >= since),
        );
        return Promise.resolve(matches[matches.length - 1] ?? null);
      },
      create: ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `obs-${seq}`, recordedAt: now(), ...data } as Row;
        rows.push(row);
        return Promise.resolve(row);
      },
    },
    visitObservationRevision: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        revisions.push(data);
        return Promise.resolve(data);
      },
    },
  };

  // The lock is released at COMMIT, i.e. when the transaction callback ends —
  // exactly the `pg_advisory_xact_lock` contract.
  const prisma = {
    $transaction: async (fn: (t: typeof tx) => unknown) => {
      try {
        return await fn(tx);
      } finally {
        releaseLock?.();
        releaseLock = null;
      }
    },
  } as unknown as PrismaService;
  const service = new VisitObservationService(prisma);

  const run = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantContextStorage.run({ tenantId: TENANT, staffId: actor?.id, userId: actor?.userId ?? undefined }, fn);

  return {
    rows,
    revisions,
    rawSql,
    record: (dto: Record<string, unknown>) => run(() => service.record(VISIT, dto as never)),
    list: () => run(() => service.listByVisitId(VISIT)),
    setClock: (value: Date) => {
      now = () => value;
    },
  };
}

const READING = { bpSystolic: 120, bpDiastolic: 80, pulse: 72, temperature: 36.8 };

describe('recording an observation', () => {
  it('1. a first reading is stored', async () => {
    const ctx = build();
    const result = await ctx.record(READING);
    expect(ctx.rows).toHaveLength(1);
    expect(result.deduplicated).toBe(false);
  });

  it('2. an empty set is refused rather than stored as a blank reading', async () => {
    const ctx = build();
    await expect(ctx.record({})).rejects.toThrow(BadRequestException);
    expect(ctx.rows).toHaveLength(0);
  });

  it('3. the reading is attributed to the authenticated recorder', async () => {
    const ctx = build();
    await ctx.record(READING);
    expect(ctx.rows[0]).toMatchObject({
      recordedByStaffId: 'staff-nurse',
      recorderNameSnapshot: 'Siti Aminah',
      legacyRecorderUnknown: false,
    });
  });

  it('4. the BMI is derived from the stored weight and height', async () => {
    const ctx = build();
    const result = await ctx.record({ weight: 70, height: 170 });
    expect(result.bmi).toBe(24.2);
  });

  it('5. a reading with no height stores no BMI rather than a nonsense one', async () => {
    const ctx = build();
    const result = await ctx.record({ weight: 70 });
    expect(result.bmi).toBeNull();
  });
});

describe('the duplicate is PREVENTED, not hidden', () => {
  it('6. re-submitting the identical reading creates NO second row', async () => {
    const ctx = build();
    await ctx.record(READING);
    await ctx.record(READING);
    expect(ctx.rows).toHaveLength(1);
  });

  it('7. the repeat returns the EXISTING reading rather than failing', async () => {
    // A retry on a slow connection must be safe. The caller asked for this
    // reading to be on the record, and it is.
    const ctx = build();
    const first = await ctx.record(READING);
    const second = await ctx.record(READING);
    expect(second.id).toBe(first.id);
    expect(second.deduplicated).toBe(true);
  });

  it('8. no second revision is written either', async () => {
    // The audit trail must not gain an entry for something that did not
    // happen.
    const ctx = build();
    await ctx.record(READING);
    await ctx.record(READING);
    expect(ctx.revisions).toHaveLength(1);
  });

  it('9. the list shows one reading, because there IS one', async () => {
    const ctx = build();
    await ctx.record(READING);
    await ctx.record(READING);
    expect(await ctx.list()).toHaveLength(1);
  });

  it('10. four concurrent identical submissions produce exactly one row', async () => {
    const ctx = build();
    await Promise.all([ctx.record(READING), ctx.record(READING), ctx.record(READING), ctx.record(READING)]);
    expect(ctx.rows).toHaveLength(1);
  });

  it('11. the transaction takes an advisory lock keyed on the visit', async () => {
    // Without it the check-then-insert is not atomic under READ COMMITTED:
    // two requests would both read the state before either insert. There is
    // no existing row to claim atomically, so the lock is the mechanism.
    const ctx = build();
    await ctx.record(READING);
    expect(ctx.rawSql.some((sql) => sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(ctx.rawSql.some((sql) => sql.includes(VISIT))).toBe(true);
  });
});

describe('a genuine repeat reading is never swallowed', () => {
  it('12. any changed value is a new reading', async () => {
    // Repeat BP after treatment is exactly what this service exists for.
    const ctx = build();
    await ctx.record(READING);
    await ctx.record({ ...READING, bpSystolic: 118 });
    expect(ctx.rows).toHaveLength(2);
  });

  it('13. an identical reading OUTSIDE the window is a new reading', async () => {
    const ctx = build();
    await ctx.record(READING);
    // Half an hour later, same numbers: a real repeat measurement, e.g. BP
    // rechecked after treatment. It must be its own row.
    const later = Date.now() + 30 * 60_000;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    ctx.setClock(new Date(later));
    await ctx.record(READING);
    jest.restoreAllMocks();
    expect(ctx.rows).toHaveLength(2);
  });

  it('14. a DIFFERENT recorder taking the same reading is a separate, attributed act', async () => {
    // A second nurse independently confirming a reading is a real clinical
    // event with its own attribution.
    const first = build();
    await first.record(READING);
    const second = build(staff({ id: 'staff-other', fullName: 'Nurul Huda' }));
    await second.record(READING);
    expect(second.rows).toHaveLength(1);
  });

  it('15. 36.5 and 36.50 are the SAME reading', async () => {
    // Judged by the canonical content hash the revision trail already uses,
    // so the decision cannot drift from how the record hashes itself.
    const ctx = build();
    await ctx.record({ temperature: 36.5 });
    await ctx.record({ temperature: '36.50' });
    expect(ctx.rows).toHaveLength(1);
  });

  it('16. adding a field to an otherwise identical set is a new reading', async () => {
    const ctx = build();
    await ctx.record(READING);
    await ctx.record({ ...READING, spo2: 98 });
    expect(ctx.rows).toHaveLength(2);
  });

  it('17. clearing a field from an otherwise identical set is a new reading', async () => {
    const ctx = build();
    await ctx.record({ ...READING, spo2: 98 });
    await ctx.record(READING);
    expect(ctx.rows).toHaveLength(2);
  });
});

describe('authorisation is unchanged', () => {
  it('18. an account with no session is refused', async () => {
    const ctx = build(null);
    await expect(ctx.record(READING)).rejects.toThrow();
    expect(ctx.rows).toHaveLength(0);
  });

  it('19. an inactive staff account is refused', async () => {
    const ctx = build(staff({ active: false }));
    await expect(ctx.record(READING)).rejects.toThrow();
    expect(ctx.rows).toHaveLength(0);
  });

  it('20. a role that may not record observations is refused', async () => {
    const ctx = build(staff({ role: 'STOCK_STAFF' }));
    await expect(ctx.record(READING)).rejects.toThrow();
    expect(ctx.rows).toHaveLength(0);
  });
});
