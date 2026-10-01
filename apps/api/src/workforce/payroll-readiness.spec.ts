import { buildPayrollReadiness, ReadinessFacts } from './payroll-readiness';

/**
 * THE READINESS CHECKLIST IS THE RUN'S OWN VIEW, IN ADVANCE.
 *
 * These vectors pin the three behaviours that matter:
 *  - the salary AMOUNT rides on the pay permission (it used to print for
 *    anybody who could open the employee record);
 *  - "ready" means "no blocking item", not "every item" — a missing bank
 *    account keeps somebody out of a payment file, not out of payroll;
 *  - monthly tax counts as settled when it can be CALCULATED, not only when
 *    a figure was keyed by hand.
 */

const COMPLETE: ReadinessFacts = {
  salary: {
    kind: 'RESOLVED',
    row: {
      id: 's1',
      basis: 'MONTHLY',
      amountCents: 320000,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
    },
    reason: 'One salary was in force for the whole period.',
  },
  mayReadPay: true,
  standing: {
    epfApplicable: true,
    epfMembership: 'MALAYSIAN_CITIZEN',
    socsoApplicable: true,
    eisApplicable: true,
    pcbApplicable: true,
    lindungParticipation: 'NOT_PARTICIPATING',
    taxResidence: 'RESIDENT',
    pcbCategory: 'CATEGORY_1',
    restDayOfWeek: 0,
  },
  legalEmployerName: 'Klinik Contoh Sdn Bhd',
  bankName: 'Maybank',
  bankAccountNo: '512345678901',
  dateOfBirth: new Date('1992-04-19T00:00:00.000Z'),
  epfNumberOnFile: true,
  socsoNumberOnFile: true,
  pcbInputAmountCents: null,
  ytd: { periodMonth: 8, taxYear: 2026, hasPriorMonths: true, employedBeforePeriod: true },
};

describe('a complete employee', () => {
  it('is ready, with every item done and none outstanding', () => {
    const result = buildPayrollReadiness(COMPLETE);
    expect(result.ready).toBe(true);
    expect(result.blockersOutstanding).toBe(0);
    expect(result.done).toBe(result.total);
  });

  it('shows the salary amount to a pay-permission holder', () => {
    const result = buildPayrollReadiness(COMPLETE);
    const salary = result.items.find((item) => item.key === 'salary')!;
    expect(salary.detail).toContain('RM3,200.00');
  });
});

describe('the salary amount is confidential', () => {
  it('never appears for a reader without the pay permission', () => {
    // The defect this guards: the employee record opens with `hr.view`, and
    // the checklist printed the amount into it regardless.
    const result = buildPayrollReadiness({ ...COMPLETE, mayReadPay: false });
    const salary = result.items.find((item) => item.key === 'salary')!;
    expect(salary.done).toBe(true);
    expect(salary.detail).not.toContain('3,200');
    expect(salary.detail).toContain('A salary is in force');
  });
});

describe('the employing company is a blocking item', () => {
  it('blocks when nobody employs this person', () => {
    const result = buildPayrollReadiness({ ...COMPLETE, legalEmployerName: null });
    const employer = result.items.find((item) => item.key === 'employer')!;
    expect(employer.severity).toBe('BLOCKING');
    expect(employer.done).toBe(false);
    expect(result.ready).toBe(false);
  });
});

describe('advisory items do not gate readiness', () => {
  it('a missing bank account leaves the person payable', () => {
    const result = buildPayrollReadiness({ ...COMPLETE, bankName: null, bankAccountNo: null });
    const bank = result.items.find((item) => item.key === 'bank')!;
    expect(bank.severity).toBe('ADVISORY');
    expect(bank.done).toBe(false);
    expect(result.ready).toBe(true);
    expect(result.blockersOutstanding).toBe(0);
  });
});

describe('monthly tax counts as settled when it can be calculated', () => {
  it('needs no hand-entered figure when residence and category are recorded', () => {
    const result = buildPayrollReadiness({ ...COMPLETE, pcbInputAmountCents: null });
    const pcb = result.items.find((item) => item.key === 'pcb')!;
    expect(pcb.done).toBe(true);
    expect(pcb.detail).toContain('calculated from the official specification');
  });

  it('a hand-entered figure also settles it', () => {
    const result = buildPayrollReadiness({
      ...COMPLETE,
      standing: { ...COMPLETE.standing, taxResidence: null, pcbCategory: null },
      pcbInputAmountCents: 41250,
    });
    const pcb = result.items.find((item) => item.key === 'pcb')!;
    expect(pcb.done).toBe(true);
    expect(pcb.detail).toContain('RM412.50');
  });

  it('neither profile nor figure blocks, and says both remedies', () => {
    const result = buildPayrollReadiness({
      ...COMPLETE,
      standing: { ...COMPLETE.standing, taxResidence: null, pcbCategory: null },
      pcbInputAmountCents: null,
    });
    const pcb = result.items.find((item) => item.key === 'pcb')!;
    expect(pcb.done).toBe(false);
    expect(pcb.severity).toBe('BLOCKING');
    expect(pcb.detail).toContain('tax residence and MTD category');
    expect(pcb.detail).toContain('by hand');
  });
});

describe('the opening-balance advisory arises only where the question does', () => {
  it('raises for a mid-year period with no recorded pay and prior employment', () => {
    const result = buildPayrollReadiness({
      ...COMPLETE,
      ytd: { periodMonth: 8, taxYear: 2026, hasPriorMonths: false, employedBeforePeriod: true },
    });
    const item = result.items.find((row) => row.key === 'ytdOpening');
    expect(item).toBeDefined();
    expect(item!.severity).toBe('ADVISORY');
    expect(item!.done).toBe(false);
    // Advisory: the person is still payable.
    expect(result.ready).toBe(true);
  });

  it('does not raise in January', () => {
    const result = buildPayrollReadiness({
      ...COMPLETE,
      ytd: { periodMonth: 1, taxYear: 2026, hasPriorMonths: false, employedBeforePeriod: true },
    });
    expect(result.items.find((row) => row.key === 'ytdOpening')).toBeUndefined();
  });

  it('does not raise for somebody who starts this month', () => {
    const result = buildPayrollReadiness({
      ...COMPLETE,
      ytd: { periodMonth: 8, taxYear: 2026, hasPriorMonths: false, employedBeforePeriod: false },
    });
    expect(result.items.find((row) => row.key === 'ytdOpening')).toBeUndefined();
  });

  it('does not raise once any month is on record', () => {
    const result = buildPayrollReadiness(COMPLETE);
    expect(result.items.find((row) => row.key === 'ytdOpening')).toBeUndefined();
  });
});

describe('the statutory standing item', () => {
  it('asks nothing about LINDUNG participation: blank is enrolled, and the run deducts it', () => {
    // PERKESO enrols every employee unless they opt out through its own form,
    // so an unrecorded participation is the default answer, not a gap. The
    // owner's decision, 1 October 2026.
    const result = buildPayrollReadiness({
      ...COMPLETE,
      standing: { ...COMPLETE.standing, lindungParticipation: null },
    });
    const statutory = result.items.find((item) => item.key === 'statutory')!;
    expect(statutory.done).toBe(true);
    expect(statutory.severity).toBe('ADVISORY');
    expect(result.ready).toBe(true);
  });

  it('does not demand a membership number for a scheme that does not apply', () => {
    const result = buildPayrollReadiness({
      ...COMPLETE,
      standing: { ...COMPLETE.standing, socsoApplicable: false },
      socsoNumberOnFile: false,
    });
    const statutory = result.items.find((item) => item.key === 'statutory')!;
    expect(statutory.done).toBe(true);
  });
});

describe('severity follows the run — this page promises blocking means the run refuses', () => {
  it('a missing membership NUMBER is advisory: it gates the filing, not the calculation', () => {
    // Seven people sat in red over missing EPF/SOCSO numbers while the run
    // itself calculated and approved the month — two answers to one question
    // from the screen built to prevent that. The employer section already
    // states the doctrine: registrations gate the filings.
    const result = buildPayrollReadiness({ ...COMPLETE, epfNumberOnFile: false, socsoNumberOnFile: false });
    const statutory = result.items.find((item) => item.key === 'statutory')!;
    expect(statutory.severity).toBe('ADVISORY');
    expect(statutory.done).toBe(false);
    expect(statutory.detail).toContain('membership number');
    expect(result.ready).toBe(true); // ready to PAY; the note travels with them
  });

  it('an unknown Part or tax profile stays BLOCKING — those stop the calculation', () => {
    const result = buildPayrollReadiness({
      ...COMPLETE,
      standing: { ...COMPLETE.standing, epfMembership: null },
    });
    const statutory = result.items.find((item) => item.key === 'statutory')!;
    expect(statutory.severity).toBe('BLOCKING');
    expect(result.ready).toBe(false);
  });

  it('before LINDUNG commenced, an unrecorded participation asks nobody anything', () => {
    const result = buildPayrollReadiness({
      ...COMPLETE,
      lindungInForce: false,
      standing: { ...COMPLETE.standing, lindungParticipation: null },
    });
    const statutory = result.items.find((item) => item.key === 'statutory')!;
    expect(statutory.done).toBe(true);
    expect(statutory.severity).toBe('ADVISORY');
  });
});
