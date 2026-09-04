import { socsoContribution } from './contributions';
import {
  LINDUNG_EFFECTIVE_FROM,
  LINDUNG_PHASE_RATES_PERCENT,
  LINDUNG_PHASES_NOT_HELD,
  lindungContribution,
} from './lindung-24-jam';
import { SOCSO_BANDS, SOCSO_WAGE_CEILING_CENTS } from './socso-act4';

/**
 * LINDUNG 24 JAM (SKBBK) — the scheme D6 printed as a column and this codebase
 * charged as though it were Act 4.
 *
 * Current PERKESO guidance supplies everything the rate table did not: when it
 * starts, who bears it, and who may decline. These tests are about those, and
 * about the money not moving where it should not.
 */

const IN_FORCE = new Date('2026-08-31T00:00:00.000Z');
const BEFORE = new Date('2026-05-31T00:00:00.000Z');

describe('when the scheme exists at all', () => {
  it('starts on 1 June 2026', () => {
    expect(LINDUNG_EFFECTIVE_FROM.toISOString().slice(0, 10)).toBe('2026-06-01');
  });

  it('owes nothing for a period before it, however the employee is classified', () => {
    // Applied without an effective date, the column was charged to every
    // employee in every historical period.
    for (const participation of ['MANDATORY_FOREIGN_WORKER', 'VOLUNTARY_OPTED_IN', 'NOT_PARTICIPATING'] as const) {
      const outcome = lindungContribution(600000, participation, BEFORE);
      expect(outcome.kind).toBe('NOT_ELIGIBLE');
      if (outcome.kind === 'NOT_ELIGIBLE') expect(outcome.reason).toMatch(/in force from 2026-06-01/);
    }
  });

  it('is in force on the first day, and not on the day before', () => {
    expect(lindungContribution(600000, 'VOLUNTARY_OPTED_IN', new Date('2026-06-01T00:00:00.000Z')).kind).toBe('COMPUTED');
    expect(lindungContribution(600000, 'VOLUNTARY_OPTED_IN', new Date('2026-05-31T23:59:59.999Z')).kind).toBe(
      'NOT_ELIGIBLE',
    );
  });
});

describe('who is in it', () => {
  it('charges a foreign worker, for whom it is mandatory', () => {
    const outcome = lindungContribution(600000, 'MANDATORY_FOREIGN_WORKER', IN_FORCE);
    expect(outcome.kind).toBe('COMPUTED');
    if (outcome.kind === 'COMPUTED') {
      expect(outcome.value.employeeCents).toBe(4465);
      expect(outcome.value.participation).toBe('MANDATORY_FOREIGN_WORKER');
    }
  });

  it('charges a local who opted in', () => {
    const outcome = lindungContribution(600000, 'VOLUNTARY_OPTED_IN', IN_FORCE);
    expect(outcome.kind).toBe('COMPUTED');
    if (outcome.kind === 'COMPUTED') expect(outcome.value.employeeCents).toBe(4465);
  });

  it('charges NOTHING to a local who has not joined — and that nil is a fact', () => {
    // The over-deduction this fixes: RM44.65 a month from a RM6,000 local who
    // never joined a voluntary scheme.
    const outcome = lindungContribution(600000, 'NOT_PARTICIPATING', IN_FORCE);
    expect(outcome.kind).toBe('NOT_ELIGIBLE');
    if (outcome.kind === 'NOT_ELIGIBLE') expect(outcome.reason).toMatch(/voluntary for local employees/);
  });

  it('refuses when participation is unrecorded, rather than assuming either answer', () => {
    // "Declined" and "nobody asked" are different, and only one is a fact.
    // Guessing nil is cheap for the clinic and wrong for a foreign worker.
    for (const unknown of [null, undefined]) {
      const outcome = lindungContribution(600000, unknown, IN_FORCE);
      expect(outcome.kind).toBe('CANNOT_DETERMINE');
      if (outcome.kind === 'CANNOT_DETERMINE') expect(outcome.reason).toMatch(/not recorded/);
    }
  });
});

describe('who bears it', () => {
  it('has no employer share at all', () => {
    // The employer REMITS it; it does not pay it. A payslip or a submission
    // that showed an employer figure would be inventing a liability.
    const outcome = lindungContribution(600000, 'VOLUNTARY_OPTED_IN', IN_FORCE);
    if (outcome.kind !== 'COMPUTED') throw new Error('expected a contribution');
    expect(outcome.value.employerCents).toBe(0);
    expect(outcome.value.remittedByEmployer).toBe(true);
  });
});

describe('how much', () => {
  it.each([
    // [monthly wages, employee contribution in cents]
    [3000, 20],
    [14000, 90],
    [70000, 485],
    [270000, 1985],
    [470000, 3485],
    [600000, 4465],
  ])('takes %s cents of wages to %s cents', (wages, expected) => {
    const outcome = lindungContribution(wages as number, 'VOLUNTARY_OPTED_IN', IN_FORCE);
    expect(outcome.kind).toBe('COMPUTED');
    if (outcome.kind === 'COMPUTED') expect(outcome.value.employeeCents).toBe(expected);
  });

  it('expresses the published 0.75% phase-1 rate, within a band’s width', () => {
    // The BANDS are what is applied — they are what PERKESO publishes for
    // contribution purposes. The percentage is asserted against them rather
    // than substituted for them, so a transcription slip cannot pass as a
    // rounding difference.
    const top = SOCSO_WAGE_CEILING_CENTS;
    const atCeiling = lindungContribution(top, 'VOLUNTARY_OPTED_IN', IN_FORCE);
    if (atCeiling.kind !== 'COMPUTED') throw new Error('expected a contribution');
    const impliedPercent = (atCeiling.value.employeeCents / top) * 100;
    expect(impliedPercent).toBeCloseTo(LINDUNG_PHASE_RATES_PERCENT.PHASE_1, 1);
    expect(impliedPercent).toBeLessThanOrEqual(LINDUNG_PHASE_RATES_PERCENT.PHASE_1);
  });

  it('caps at the RM6,000 ceiling', () => {
    const capped = lindungContribution(975000, 'VOLUNTARY_OPTED_IN', IN_FORCE);
    if (capped.kind !== 'COMPUTED') throw new Error('expected a contribution');
    expect(capped.value.employeeCents).toBe(4465);
    expect(capped.value.atCeiling).toBe(true);
  });

  it('takes nothing from nothing', () => {
    const nil = lindungContribution(0, 'MANDATORY_FOREIGN_WORKER', IN_FORCE);
    if (nil.kind !== 'COMPUTED') throw new Error('expected a contribution');
    expect(nil.value.employeeCents).toBe(0);
  });

  it('applies phase 1, and says so, because later phases are not held', () => {
    const outcome = lindungContribution(600000, 'VOLUNTARY_OPTED_IN', IN_FORCE);
    if (outcome.kind !== 'COMPUTED') throw new Error('expected a contribution');
    expect(outcome.value.phase).toBe('PHASE_1');
    expect(LINDUNG_PHASE_RATES_PERCENT).toEqual({ PHASE_1: 0.75, PHASE_2: 1.0, PHASE_3: 1.25 });
    expect(LINDUNG_PHASES_NOT_HELD).toMatch(/Only the phase 1 schedule/);
  });
});

describe('what leaving Act 4 alone means', () => {
  it('takes the SKBBK column out of the SOCSO employee deduction', () => {
    // At RM6,000 the employee's Act 4 share is the invalidity 29.75 ALONE.
    // Folded together it read 74.40, which charged every employee for a
    // voluntary scheme they may never have joined.
    const first = socsoContribution(600000, 'FIRST');
    if (first.kind !== 'COMPUTED') throw new Error('expected a contribution');
    expect(first.value.employeeCents).toBe(2975);
    expect(first.value.employeeInvalidityCents).toBe(2975);
    expect(first.value.employerCents).toBe(10415);
  });

  it('leaves the Second Category employer-only, as Act 4 has it', () => {
    const second = socsoContribution(600000, 'SECOND');
    if (second.kind !== 'COMPUTED') throw new Error('expected a contribution');
    expect(second.value.employeeCents).toBe(0);
    expect(second.value.employerCents).toBe(7440);
  });

  it('still adds up to the printed row when both schemes apply', () => {
    // The reconciliation that proves nothing was lost in the separation: Act 4
    // plus LINDUNG equals the total D6 prints for a participating employee.
    const act4 = socsoContribution(600000, 'FIRST');
    const lindung = lindungContribution(600000, 'VOLUNTARY_OPTED_IN', IN_FORCE);
    if (act4.kind !== 'COMPUTED' || lindung.kind !== 'COMPUTED') throw new Error('expected contributions');
    const [, , , c1Inv, c1Nei] = SOCSO_BANDS[SOCSO_BANDS.length - 1];
    expect(act4.value.employeeCents + lindung.value.employeeCents).toBe(c1Inv + c1Nei);
  });
});
