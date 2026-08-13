import {
  DAYS_PER_DURATION_UNIT,
  composeSnapshot,
  computeQuantity,
  durationInDays,
  labelDirections,
} from './prescription-snapshot';

// ===========================================================================
// b1 PHASE A — WHAT THE PRESCRIPTION KEEPS, AND WHAT THE LABEL SAYS.
//
// The rules worth pinning are the ones whose failure is silent: a quantity
// computed for a frequency that has no daily count, a label line printed with
// an empty bracket where a Malay label should be, and a month that means one
// number here and a different one there.
// ===========================================================================

describe('a course is converted once, in one place', () => {
  it.each([
    [2, 'DAY' as const, 2],
    [2, 'WEEK' as const, 14],
    [1, 'MONTH' as const, 30],
    [3, 'MONTH' as const, 90],
  ])('%s %s is %s days', (value, unit, days) => {
    expect(durationInDays(value, unit)).toBe(days);
  });

  it('says what a month is, rather than implying it', () => {
    // 30, not 28 and not "one calendar month". Written down because a second
    // opinion about this elsewhere would be two different courses for one
    // prescription.
    expect(DAYS_PER_DURATION_UNIT.MONTH).toBe(30);
  });
});

describe('the snapshot copies both halves, or nothing', () => {
  const OD = { code: 'OD', patientLabelBm: 'Sekali sehari', timesPerDay: 1 };
  const TABLET = { systemNameEn: 'Tablet', patientLabelBm: 'BIJI' };
  const ORAL = { methodBilingual: 'ORAL (MAKAN/MINUM)', patientInstructionBm: 'Ambil melalui mulut' };
  const FEVER = { labelEn: 'Fever', labelBm: 'Demam' };

  it('takes the doctor\'s word and the patient\'s word together', () => {
    expect(composeSnapshot({ frequency: OD, doseUnit: TABLET, consumptionMethod: ORAL, indication: FEVER })).toEqual({
      frequency: 'OD',
      frequencyBm: 'Sekali sehari',
      unit: 'Tablet',
      doseUnitBm: 'BIJI',
      consumptionMethod: 'ORAL (MAKAN/MINUM)',
      consumptionInstructionBm: 'Ambil melalui mulut',
      indication: 'Fever',
      indicationBm: 'Demam',
    });
  });

  it('contributes NOTHING for a choice that was not made', () => {
    // Not empty strings. "The doctor did not pick a route" is a real state,
    // and '' prints as a blank line on a label 40mm tall.
    expect(composeSnapshot({ frequency: OD })).toEqual({
      frequency: 'OD',
      frequencyBm: 'Sekali sehari',
    });
    expect(composeSnapshot({})).toEqual({});
  });
});

describe('quantity is computed, or honestly declined', () => {
  it('2 tablets TDS for 5 days is 30', () => {
    expect(computeQuantity({ doseAmount: 2, timesPerDay: 3, durationDays: 5 })).toBe(30);
  });

  it('declines for a frequency that cannot be counted', () => {
    // PRN and STAT carry a null timesPerDay. Collapsing that into 1 would put
    // a number nobody decided on a when-required painkiller, and a dispensary
    // would hand it over.
    expect(computeQuantity({ doseAmount: 2, timesPerDay: null, durationDays: 5 })).toBeNull();
  });

  it('rounds a part-tablet course UP', () => {
    // 0.5 x 1 x 5 = 2.5. Rounding down is four days of a five-day course.
    expect(computeQuantity({ doseAmount: 0.5, timesPerDay: 1, durationDays: 5 })).toBe(3);
  });

  it.each([
    ['no dose', { doseAmount: null, timesPerDay: 3, durationDays: 5 }],
    ['no duration', { doseAmount: 2, timesPerDay: 3, durationDays: null }],
  ])('declines with %s', (_label, input) => {
    expect(computeQuantity(input)).toBeNull();
  });
});

describe('the label directions read in both languages', () => {
  const FULL = {
    amount: 2,
    unit: 'Tablet',
    doseUnitBm: 'BIJI',
    frequency: 'TDS',
    frequencyBm: 'Tiga kali sehari',
    consumptionInstructionBm: 'Ambil melalui mulut',
    durationDays: 5,
  };

  it('prints the code AND the Malay for the frequency', () => {
    expect(labelDirections(FULL)).toBe(
      '2 Tablet (BIJI) — TDS (Tiga kali sehari) — Ambil melalui mulut — 5 days',
    );
  });

  it('omits a half the record does not carry, rather than printing brackets', () => {
    // A prescription written through Flow or carried over by Copy Rx has no
    // Malay label. "TDS ()" is worse than "TDS".
    expect(labelDirections({ ...FULL, frequencyBm: null, doseUnitBm: null })).toBe(
      '2 Tablet — TDS — Ambil melalui mulut — 5 days',
    );
  });

  it('omits the route entirely when none was chosen', () => {
    expect(labelDirections({ ...FULL, consumptionInstructionBm: null })).toBe(
      '2 Tablet (BIJI) — TDS (Tiga kali sehari) — 5 days',
    );
  });

  it('says "day" for one day', () => {
    expect(labelDirections({ ...FULL, durationDays: 1 })).toMatch(/1 day$/);
  });

  it('drops the duration when there is none, rather than printing "0 days"', () => {
    expect(labelDirections({ ...FULL, durationDays: 0 })).not.toMatch(/day/);
  });

  it('still reads as something with only a dose', () => {
    expect(labelDirections({ amount: 5 })).toBe('5');
  });
});
