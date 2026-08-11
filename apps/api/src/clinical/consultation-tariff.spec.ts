import {
  isWithinBand,
  localMinutesOfDay,
  matchTariffRule,
  parseTimeOfDay,
  resolveConsultationState,
  resolveExplicitConsultationAdd,
  TariffRuleForMatching,
} from './consultation-tariff';

// ===========================================================================
// G4.5d3c-3b2 (D-094) — CONSULTATION TARIFF RESOLUTION (owner tests 36–53
// backend halves). The tariff must follow the CONSULTATION START, support
// midnight-crossing bands, refuse to guess where configuration is missing,
// and stay entirely OFF for a clinic with no rules.
// ===========================================================================

const KL = 'Asia/Kuala_Lumpur';

function rule(partial: Partial<TariffRuleForMatching> & { id: string }): TariffRuleForMatching {
  return {
    classification: 'CONSULTATION',
    startTime: '08:00',
    endTime: '22:59',
    effectiveFrom: null,
    effectiveTo: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    serviceCatalog: { id: `svc-${partial.id}`, name: `Service ${partial.id}`, active: true },
    ...partial,
  };
}

// The owner's cash example: Day 08:00–22:59 → RM35 service, Night
// 23:00–07:59 → RM50 service.
const DAY = rule({ id: 'day', startTime: '08:00', endTime: '22:59' });
const NIGHT = rule({ id: 'night', startTime: '23:00', endTime: '07:59' });

/** A UTC instant whose Kuala Lumpur wall clock reads the given HH:MM. */
function klInstant(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  // KL is UTC+8 year-round.
  return new Date(Date.UTC(2026, 7, 4, (h - 8 + 24) % 24, m));
}

describe('time bands', () => {
  it('parses HH:MM and rejects malformed values', () => {
    expect(parseTimeOfDay('08:00')).toBe(480);
    expect(parseTimeOfDay('22:59')).toBe(1379);
    expect(() => parseTimeOfDay('24:00')).toThrow();
    expect(() => parseTimeOfDay('8am')).toThrow();
  });

  it('a normal band is inclusive at both ends', () => {
    expect(isWithinBand(480, '08:00', '22:59')).toBe(true);
    expect(isWithinBand(1379, '08:00', '22:59')).toBe(true);
    expect(isWithinBand(479, '08:00', '22:59')).toBe(false);
    expect(isWithinBand(1380, '08:00', '22:59')).toBe(false);
  });

  it('38. a midnight-crossing band covers both sides of midnight', () => {
    expect(isWithinBand(parseTimeOfDay('23:00'), '23:00', '07:59')).toBe(true);
    expect(isWithinBand(parseTimeOfDay('03:00'), '23:00', '07:59')).toBe(true);
    expect(isWithinBand(parseTimeOfDay('07:59'), '23:00', '07:59')).toBe(true);
    expect(isWithinBand(parseTimeOfDay('08:00'), '23:00', '07:59')).toBe(false);
    expect(isWithinBand(parseTimeOfDay('22:59'), '23:00', '07:59')).toBe(false);
  });

  it('converts a real UTC instant to clinic-local wall clock', () => {
    // 14:55 UTC is 22:55 in Kuala Lumpur.
    expect(localMinutesOfDay(new Date('2026-08-04T14:55:00Z'), KL)).toBe(22 * 60 + 55);
  });
});

describe('rule matching', () => {
  it('36/37. daytime start picks the day rule; nighttime start picks the night rule', () => {
    expect(matchTariffRule([DAY, NIGHT], { instant: klInstant('10:30'), timeZone: KL, classification: 'CONSULTATION' })?.id).toBe('day');
    expect(matchTariffRule([DAY, NIGHT], { instant: klInstant('23:30'), timeZone: KL, classification: 'CONSULTATION' })?.id).toBe('night');
    expect(matchTariffRule([DAY, NIGHT], { instant: klInstant('03:00'), timeZone: KL, classification: 'CONSULTATION' })?.id).toBe('night');
  });

  it("39. the owner's example: consult at 22:55, billing later — the DAY tariff applies", () => {
    // Consultation starts 10:55pm; the invoice is opened 11:10pm. Only the
    // 10:55pm instant enters the matcher, so the day rule (to 22:59) wins.
    expect(matchTariffRule([DAY, NIGHT], { instant: klInstant('22:55'), timeZone: KL, classification: 'CONSULTATION' })?.id).toBe('day');
  });

  it('overlapping rules resolve deterministically: narrowest band wins', () => {
    const allDay = rule({ id: 'all-day', startTime: '00:00', endTime: '23:59' });
    const lunch = rule({ id: 'lunch', startTime: '12:00', endTime: '14:00' });
    expect(matchTariffRule([allDay, lunch], { instant: klInstant('13:00'), timeZone: KL, classification: 'CONSULTATION' })?.id).toBe('lunch');
    expect(matchTariffRule([allDay, lunch], { instant: klInstant('09:00'), timeZone: KL, classification: 'CONSULTATION' })?.id).toBe('all-day');
  });

  it('an expired or not-yet-effective rule does not match', () => {
    const expired = rule({ id: 'old', effectiveTo: new Date('2026-01-31T00:00:00Z') });
    const future = rule({ id: 'future', effectiveFrom: new Date('2027-01-01T00:00:00Z') });
    expect(matchTariffRule([expired, future], { instant: klInstant('10:00'), timeZone: KL, classification: 'CONSULTATION' })).toBeNull();
  });

  it('a rule for another classification never matches', () => {
    const dressing = rule({ id: 'dressing', classification: 'DRESSING_ONLY' });
    expect(matchTariffRule([dressing], { instant: klInstant('10:00'), timeZone: KL, classification: 'CONSULTATION' })).toBeNull();
    expect(matchTariffRule([dressing], { instant: klInstant('10:00'), timeZone: KL, classification: 'DRESSING_ONLY' })?.id).toBe('dressing');
  });
});

// ---------------------------------------------------------------------------
// resolveConsultationState against a mocked transaction
// ---------------------------------------------------------------------------

interface World {
  visit?: Record<string, unknown> | null;
  rules?: TariffRuleForMatching[];
  consultationLines?: Array<Record<string, unknown>>;
  startEvent?: { createdAt: Date } | null;
}

function txWith(world: World) {
  return {
    visit: {
      findUnique: jest.fn().mockResolvedValue(
        world.visit === null
          ? null
          : {
              id: 'visit-1',
              clinicId: 'clinic-1',
              classification: null,
              checkInAt: new Date('2026-08-04T01:00:00Z'),
              clinic: { timezone: KL },
              queueTicket: { queueType: 'WALK_IN', status: 'IN_CONSULTATION', calledAt: null },
              ...world.visit,
            },
      ),
    },
    consultationTariffRule: { findMany: jest.fn().mockResolvedValue(world.rules ?? []) },
    invoiceLine: { findMany: jest.fn().mockResolvedValue(world.consultationLines ?? []) },
    visitWorkflowEvent: {
      findFirst: jest.fn().mockResolvedValue(world.startEvent === undefined ? null : world.startEvent),
    },
  } as never;
}

describe('resolveConsultationState', () => {
  it('a clinic with no active rules is NOT_CONFIGURED — auto-billing entirely off', async () => {
    const state = await resolveConsultationState(txWith({ rules: [] }), 'visit-1');
    expect(state).toEqual({ kind: 'NOT_CONFIGURED' });
  });

  it('a visit that never reached consultation is NOT_APPLICABLE', async () => {
    const state = await resolveConsultationState(
      txWith({ rules: [DAY], visit: { queueTicket: { queueType: 'WALK_IN', status: 'WAITING', calledAt: null } } }),
      'visit-1',
    );
    expect(state).toEqual({ kind: 'NOT_APPLICABLE' });
  });

  it('52. an existing ACTIVE consultation line means BILLED — never a second charge', async () => {
    const state = await resolveConsultationState(
      txWith({
        rules: [DAY],
        consultationLines: [{ id: 'line-1', description: 'Consultation (Day)', cancelledAt: null }],
      }),
      'visit-1',
    );
    expect(state).toMatchObject({ kind: 'BILLED', invoiceLineId: 'line-1' });
  });

  it('a cancelled consultation line means WAIVED — never silently re-added', async () => {
    const state = await resolveConsultationState(
      txWith({
        rules: [DAY],
        consultationLines: [{ id: 'line-1', description: 'Consultation (Day)', cancelledAt: new Date() }],
        startEvent: { createdAt: klInstant('10:00') },
      }),
      'visit-1',
    );
    expect(state).toMatchObject({ kind: 'WAIVED', invoiceLineId: 'line-1' });
  });

  it('48. an OTC-queue visit is derived OTC_ONLY and EXEMPT when no OTC rule exists', async () => {
    const state = await resolveConsultationState(
      txWith({
        rules: [DAY],
        visit: { queueTicket: { queueType: 'OTC', status: 'IN_CONSULTATION', calledAt: null } },
        startEvent: { createdAt: klInstant('10:00') },
      }),
      'visit-1',
    );
    expect(state).toEqual({ kind: 'EXEMPT', classification: 'OTC_ONLY' });
  });

  it('49. an explicit DRESSING_ONLY classification is EXEMPT when no dressing rule exists', async () => {
    const state = await resolveConsultationState(
      txWith({
        rules: [DAY],
        visit: { classification: 'DRESSING_ONLY' },
        startEvent: { createdAt: klInstant('10:00') },
      }),
      'visit-1',
    );
    expect(state).toEqual({ kind: 'EXEMPT', classification: 'DRESSING_ONLY' });
  });

  it('50. a classification WITH its own configured rule is not exempt — configuration decides', async () => {
    const procedureRule = rule({ id: 'proc', classification: 'PROCEDURE_ONLY' });
    const state = await resolveConsultationState(
      txWith({
        rules: [DAY, procedureRule],
        visit: { classification: 'PROCEDURE_ONLY' },
        startEvent: { createdAt: klInstant('10:00') },
      }),
      'visit-1',
    );
    expect(state).toMatchObject({ kind: 'READY', rule: { id: 'proc' } });
  });

  it('51. a time not covered by any band is TARIFF_REVIEW — no guessed line', async () => {
    const state = await resolveConsultationState(
      txWith({
        rules: [rule({ id: 'short', startTime: '08:00', endTime: '12:00' })],
        startEvent: { createdAt: klInstant('20:00') },
      }),
      'visit-1',
    );
    expect(state).toMatchObject({ kind: 'TARIFF_REVIEW' });
  });

  it('an inactive selected service is TARIFF_REVIEW, never billed blind', async () => {
    const inactive = rule({ id: 'day2' });
    inactive.serviceCatalog = { id: 'svc', name: 'Old consult', active: false };
    const state = await resolveConsultationState(
      txWith({ rules: [inactive], startEvent: { createdAt: klInstant('10:00') } }),
      'visit-1',
    );
    expect(state).toMatchObject({ kind: 'TARIFF_REVIEW' });
  });

  it('39/40/41. READY carries the CONSULTATION-START instant — the only time input', async () => {
    const state = await resolveConsultationState(
      txWith({ rules: [DAY, NIGHT], startEvent: { createdAt: klInstant('22:55') } }),
      'visit-1',
    );
    expect(state).toMatchObject({
      kind: 'READY',
      rule: { id: 'day' },
      consultationStartAt: klInstant('22:55'),
    });
  });

  it('falls back to calledAt, then checkInAt, for visits that predate the start event', async () => {
    const viaCalled = await resolveConsultationState(
      txWith({
        rules: [DAY, NIGHT],
        visit: { queueTicket: { queueType: 'WALK_IN', status: 'IN_CONSULTATION', calledAt: klInstant('23:30') } },
        startEvent: null,
      }),
      'visit-1',
    );
    expect(viaCalled).toMatchObject({ kind: 'READY', rule: { id: 'night' } });

    const viaCheckIn = await resolveConsultationState(
      txWith({
        rules: [DAY, NIGHT],
        visit: { queueTicket: null, checkInAt: klInstant('09:15') },
        startEvent: null,
      }),
      'visit-1',
    );
    expect(viaCheckIn).toMatchObject({ kind: 'READY', rule: { id: 'day' } });
  });
});

describe('resolveExplicitConsultationAdd (owner decision 9, tests 64/65)', () => {
  it('64. an EXEMPT visit where a consultation occurred resolves against the CONSULTATION rules', async () => {
    const tx = txWith({
      rules: [DAY],
      visit: { classification: 'DRESSING_ONLY' },
      startEvent: { createdAt: klInstant('10:00') },
    });
    const state = await resolveExplicitConsultationAdd(tx, 'visit-1');
    expect(state).toMatchObject({ kind: 'READY', rule: { id: 'day' } });
  });

  it('65. after a waiver, an explicit re-add resolves READY — the automatic path stays WAIVED', async () => {
    const tx = txWith({
      rules: [DAY],
      consultationLines: [{ id: 'line-1', description: 'Consultation (Day)', cancelledAt: new Date() }],
      startEvent: { createdAt: klInstant('10:00') },
    });
    expect(await resolveConsultationState(tx, 'visit-1')).toMatchObject({ kind: 'WAIVED' });
    expect(await resolveExplicitConsultationAdd(tx, 'visit-1')).toMatchObject({ kind: 'READY', rule: { id: 'day' } });
  });

  it('an already-billed consultation refuses the explicit path too', async () => {
    const tx = txWith({
      rules: [DAY],
      consultationLines: [{ id: 'line-1', description: 'Consultation (Day)', cancelledAt: null }],
    });
    expect(await resolveExplicitConsultationAdd(tx, 'visit-1')).toMatchObject({ kind: 'BILLED' });
  });
});
