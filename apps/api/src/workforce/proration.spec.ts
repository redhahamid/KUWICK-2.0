import { describeProration, proratedBasicCents, prorationFor } from './proration';

/** August 2026 — 31 days. */
const AUG = {
  periodStart: new Date('2026-08-01T00:00:00.000Z'),
  periodEnd: new Date('2026-09-01T00:00:00.000Z'),
  daysInPeriod: 31,
};
/** February 2026 — 28 days, which is where a hardcoded 30 or 26 shows up. */
const FEB = {
  periodStart: new Date('2026-02-01T00:00:00.000Z'),
  periodEnd: new Date('2026-03-01T00:00:00.000Z'),
  daysInPeriod: 28,
};

const on = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('a complete month', () => {
  it('is not prorated when the employee served all of it', () => {
    const p = prorationFor({ ...AUG, startDate: on('2024-01-01'), endDate: null });
    expect(p).toMatchObject({ complete: true, daysEligible: 31, joinedOn: null, leftOn: null });
    expect(proratedBasicCents(300000, p, 31)).toBe(300000);
    expect(describeProration(p, 31)).toBeNull();
  });

  it('counts a start on the first day and an end on the last as a full month', () => {
    // Both ends inclusive. Off by one here costs every leaver a day's pay.
    const p = prorationFor({ ...AUG, startDate: on('2026-08-01'), endDate: on('2026-08-31') });
    expect(p.daysEligible).toBe(31);
    expect(p.complete).toBe(true);
  });
});

describe('a joiner', () => {
  it('is paid from the day they started, both ends inclusive', () => {
    const p = prorationFor({ ...AUG, startDate: on('2026-08-20'), endDate: null });
    // 20th to 31st inclusive is 12 days, not 11.
    expect(p.daysEligible).toBe(12);
    expect(p.joinedOn).toEqual(on('2026-08-20'));
    expect(p.complete).toBe(false);
  });

  it('divides by the days in THAT month, not by 26 and not by 30', () => {
    // s.18A uses the wage period; s.60I(1A)'s 26 answers a different question.
    const p = prorationFor({ ...FEB, startDate: on('2026-02-15'), endDate: null });
    expect(p.daysEligible).toBe(14);
    // RM3,000 x 14/28 = RM1,500 exactly.
    expect(proratedBasicCents(300000, p, 28)).toBe(150000);
    // Against a 26-day divisor this would have been RM1,615.38, and against 30
    // it would have been RM1,400. Both are wrong, and differently wrong.
    expect(proratedBasicCents(300000, p, 28)).not.toBe(161538);
  });

  it('rounds once, at the end', () => {
    // RM3,333.33 x 12/31 = RM1,290.32258…, which must land on 1290.32 rather
    // than on a figure built from a pre-rounded daily rate.
    const p = prorationFor({ ...AUG, startDate: on('2026-08-20'), endDate: null });
    expect(proratedBasicCents(333333, p, 31)).toBe(129032);
  });
});

describe('a leaver', () => {
  it('is paid to the day they left, inclusive', () => {
    const p = prorationFor({ ...AUG, startDate: on('2024-01-01'), endDate: on('2026-08-03') });
    expect(p.daysEligible).toBe(3);
    expect(p.leftOn).toEqual(on('2026-08-03'));
    expect(proratedBasicCents(310000, p, 31)).toBe(30000);
  });

  it('handles somebody who both joined and left inside one month', () => {
    const p = prorationFor({ ...AUG, startDate: on('2026-08-10'), endDate: on('2026-08-19') });
    expect(p.daysEligible).toBe(10);
    expect(describeProration(p, 31)).toBe('Paid for 10 of 31 days: they started on 2026-08-10 and left on 2026-08-19.');
  });
});

describe('somebody who was not employed during the period at all', () => {
  it('is flagged as outside it rather than paid a prorated amount', () => {
    // A leaver whose record is still marked ACTIVE. Paying them 0/31 of a
    // month and calling it a payslip is not better than paying them a month;
    // they simply are not on this payroll.
    const left = prorationFor({ ...AUG, startDate: on('2024-01-01'), endDate: on('2026-07-31') });
    expect(left.outsidePeriod).toBe(true);
    expect(left.daysEligible).toBe(0);

    const notYet = prorationFor({ ...AUG, startDate: on('2026-09-01'), endDate: null });
    expect(notYet.outsidePeriod).toBe(true);
  });

  it('treats the boundary days as inside, not outside', () => {
    expect(prorationFor({ ...AUG, startDate: on('2024-01-01'), endDate: on('2026-08-01') }).outsidePeriod).toBe(false);
    expect(prorationFor({ ...AUG, startDate: on('2026-08-31'), endDate: null }).outsidePeriod).toBe(false);
  });
});

describe('a stored timestamp with a time on it', () => {
  it('does not shift the day count', () => {
    // Dates arrive from Prisma as DateTime. A 16:00 start must not read as a
    // different day, or a proration silently changes with the server's clock.
    const p = prorationFor({
      ...AUG,
      startDate: new Date('2026-08-20T16:30:00.000Z'),
      endDate: null,
    });
    expect(p.daysEligible).toBe(12);
  });
});
