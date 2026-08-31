import {
  addCalendarDays,
  addWorkingDays,
  daysPastDue,
  isOverdue,
  resolveResubmissionWindow,
  resolveTermWindow,
} from './payment-terms';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('addWorkingDays', () => {
  it('skips the weekend', () => {
    // Friday 2026-01-02 + 1 working day = Monday 2026-01-05.
    expect(addWorkingDays(d('2026-01-02'), 1).toISOString().slice(0, 10)).toBe('2026-01-05');
  });

  it('is roughly half as long again as calendar days over a real term', () => {
    // The whole reason WORKING_DAYS has to exist: 30 working days from a
    // Monday is 42 calendar days, not 30.
    const from = d('2026-01-05'); // Monday
    expect(addWorkingDays(from, 30).toISOString().slice(0, 10)).toBe('2026-02-16');
    expect(addCalendarDays(from, 30).toISOString().slice(0, 10)).toBe('2026-02-04');
  });

  it('returns the start date for zero or negative days', () => {
    expect(addWorkingDays(d('2026-01-05'), 0).toISOString()).toBe(d('2026-01-05').toISOString());
  });
});

describe('resolveTermWindow', () => {
  it('a single-number calendar term has one edge', () => {
    const w = resolveTermWindow({ nominalDays: 60 }, { submittedAt: d('2026-01-01') });
    expect(w.resolved).toBe(true);
    expect(w.chaseFrom?.toISOString().slice(0, 10)).toBe('2026-03-02');
    expect(w.dueBy?.toISOString().slice(0, 10)).toBe('2026-03-02');
    expect(w.excludesPublicHolidaysOnly).toBe(false);
  });

  it('a range term has two, and they are different dates', () => {
    // "60 - 90 DAYS" — chase at 60, genuinely late at 90.
    const w = resolveTermWindow({ nominalDays: 60, maxDays: 90 }, { submittedAt: d('2026-01-01') });
    expect(w.chaseFrom?.toISOString().slice(0, 10)).toBe('2026-03-02');
    expect(w.dueBy?.toISOString().slice(0, 10)).toBe('2026-04-01');
  });

  it('a working-day term skips weekends and says holidays are not modelled', () => {
    const w = resolveTermWindow(
      { nominalDays: 30, unit: 'WORKING_DAYS' },
      { submittedAt: d('2026-01-05') },
    );
    expect(w.dueBy?.toISOString().slice(0, 10)).toBe('2026-02-16');
    expect(w.excludesPublicHolidaysOnly).toBe(true);
  });

  it('an invoice-date anchor counts from the invoice, not the submission', () => {
    const w = resolveTermWindow(
      { nominalDays: 90, anchor: 'INVOICE_DATE' },
      { submittedAt: d('2026-01-01'), invoiceDate: d('2026-01-31') },
    );
    expect(w.anchorDate?.toISOString().slice(0, 10)).toBe('2026-01-31');
    expect(w.dueBy?.toISOString().slice(0, 10)).toBe('2026-05-01');
  });

  it('a service-date anchor counts from the service', () => {
    const w = resolveTermWindow(
      { nominalDays: 30, anchor: 'SERVICE_DATE' },
      { serviceDate: d('2026-02-01'), submittedAt: d('2026-02-20') },
    );
    expect(w.dueBy?.toISOString().slice(0, 10)).toBe('2026-03-03');
  });

  it('refuses to resolve a term that varies by the employer behind the claim', () => {
    const w = resolveTermWindow(
      { nominalDays: 60, variesByPayer: true },
      { submittedAt: d('2026-01-01') },
    );
    expect(w.resolved).toBe(false);
    expect(w.dueBy).toBeNull();
    expect(w.reason).toMatch(/employer behind each claim/i);
  });

  it('refuses to resolve when no term is configured', () => {
    const w = resolveTermWindow({ nominalDays: null }, { submittedAt: d('2026-01-01') });
    expect(w.resolved).toBe(false);
    expect(w.reason).toMatch(/No payment term is configured/i);
  });

  it('refuses to resolve before the clock has started', () => {
    // An unsent claim cannot be overdue.
    const w = resolveTermWindow({ nominalDays: 60 }, { submittedAt: null });
    expect(w.resolved).toBe(false);
    expect(w.reason).toMatch(/has not started/i);
  });
});

describe('isOverdue', () => {
  const range = resolveTermWindow({ nominalDays: 60, maxDays: 90 }, { submittedAt: d('2026-01-01') });

  it('is judged against the FAR edge of a range, not the near one', () => {
    // Day 75: past the chase date, still inside the contract.
    expect(isOverdue(range, d('2026-03-17'), false)).toBe(false);
    // Day 95: genuinely late.
    expect(isOverdue(range, d('2026-04-06'), false)).toBe(true);
  });

  it('a settled claim is never overdue', () => {
    expect(isOverdue(range, d('2027-01-01'), true)).toBe(false);
  });

  it('an unresolved window is never overdue — not knowing is not the same as on time', () => {
    const unknown = resolveTermWindow({ nominalDays: null }, { submittedAt: d('2020-01-01') });
    expect(isOverdue(unknown, d('2026-01-01'), false)).toBe(false);
  });

  it('daysPastDue is null rather than a number when nothing was ever due', () => {
    const unknown = resolveTermWindow({ nominalDays: null }, { submittedAt: d('2020-01-01') });
    expect(daysPastDue(unknown, d('2026-01-01'))).toBeNull();
    expect(daysPastDue(range, d('2026-04-06'))).toBe(5);
    expect(daysPastDue(range, d('2026-03-17'))).toBeLessThan(0);
  });
});

describe('resolveResubmissionWindow', () => {
  it('counts down the re-claim deadline from the ORIGINAL service date', () => {
    // "Max 2 BULAN dari previous service date" — 60 days here.
    const w = resolveResubmissionWindow(60, d('2026-01-01'), d('2026-02-01'));
    expect(w.resolved).toBe(true);
    expect(w.deadline?.toISOString().slice(0, 10)).toBe('2026-03-02');
    expect(w.daysRemaining).toBe(29);
    expect(w.expired).toBe(false);
  });

  it('reports an expired window rather than a negative countdown nobody reads', () => {
    const w = resolveResubmissionWindow(60, d('2026-01-01'), d('2026-05-01'));
    expect(w.expired).toBe(true);
    expect(w.daysRemaining).toBeLessThan(0);
  });

  it('says it does not know rather than inventing a deadline', () => {
    expect(resolveResubmissionWindow(null, d('2026-01-01'), d('2026-02-01')).resolved).toBe(false);
    expect(resolveResubmissionWindow(60, null, d('2026-02-01')).reason).toMatch(/original service date/i);
  });
});
