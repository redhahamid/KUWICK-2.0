import { describe, expect, it } from 'vitest';
import { employeeStatutory, isDraftRun, payslipTotals, renderPayslipHtml } from './payslip';
import type { PayrollRunDetail } from '../types';

const LINE: PayrollRunDetail['lines'][number] = {
  id: 'line-1',
  staffId: 'staff-1',
  name: 'Nurul Huda',
  snapshot: {
    name: 'Nurul Huda',
    employeeNo: 'E-014',
    position: 'Staff Nurse',
    department: 'Clinical',
    employmentType: 'FULL_TIME',
    bankName: 'Bank Contoh',
    statutoryApplicability: { epf: true, socso: true, eis: true, pcb: true },
  },
  basicSalary: 3000,
  allowances: 200,
  overtimePay: 150,
  incentives: 0,
  bonus: 0,
  grossPay: 3350,
  unpaidLeaveDeduction: 0,
  otherDeductions: 0,
  epfEmployee: 368.5,
  epfEmployer: 435.5,
  socsoEmployee: 16.75,
  socsoEmployer: 58.65,
  eisEmployee: 6.7,
  eisEmployer: 6.7,
  pcb: 45,
  netPay: 2913.05,
  employerCost: 3851.85,
  workedDays: 26,
  unpaidDays: 0,
  overtimeHours: 6,
  breakdown: {},
};

const RUN: PayrollRunDetail = {
  id: 'run-1',
  period: '2026-08',
  clinicName: 'Contoh Central',
  status: 'APPROVED',
  statutoryStatus: 'CONFIGURED',
  statutoryNotice: null,
  grossTotal: 3350,
  deductionTotal: 436.95,
  netTotal: 2913.05,
  employerCostTotal: 3851.85,
  employeeCount: 1,
  calculatedAt: '2026-08-25T00:00:00.000Z',
  approvedAt: '2026-08-26T00:00:00.000Z',
  approvedBy: 'Dr Aisyah Rahman',
  createdBy: 'Dr Aisyah Rahman',
  paidAt: null,
  lines: [LINE],
  adjustments: [],
};

const CONTEXT = { employerName: 'Klinik Contoh', printedBy: 'Dr Aisyah Rahman', printedAt: new Date('2026-08-31T09:00:00Z') };

describe('a payslip is a statutory record, not a report', () => {
  it('1. an approved run prints a payslip with no draft watermark', () => {
    const html = renderPayslipHtml(RUN, LINE, CONTEXT);
    // The class is always in the stylesheet; what matters is whether the
    // element is on the page.
    expect(html).not.toContain('<div class="draft-watermark">');
    expect(html).not.toContain('NOT A PAYSLIP');
    expect(html).toContain('Nurul Huda');
    expect(html).toContain('Staff Nurse');
  });

  it.each(['DRAFT', 'CALCULATED', 'CANCELLED'])(
    '2. a %s run prints DRAFT — NOT A PAYSLIP, on the paper',
    (status) => {
      expect(isDraftRun(status)).toBe(true);
      const html = renderPayslipHtml({ ...RUN, status }, LINE, CONTEXT);
      expect(html).toContain('<div class="draft-watermark">');
      expect(html).toContain('NOT A PAYSLIP');
      // The watermark must survive printing, not just appear on screen.
      expect(html).toContain('print-color-adjust: exact');
    },
  );

  it('3. a PAID run is not a draft', () => {
    expect(isDraftRun('PAID')).toBe(false);
    expect(renderPayslipHtml({ ...RUN, status: 'PAID' }, LINE, CONTEXT)).not.toContain('NOT A PAYSLIP');
  });

  it('4. PROVISIONAL rates are declared on the slip, in the run’s own words', () => {
    const notice = 'The statutory rates used have not been verified against the authority’s published tables.';
    const html = renderPayslipHtml(
      { ...RUN, statutoryStatus: 'PROVISIONAL', statutoryNotice: notice },
      LINE,
      CONTEXT,
    );
    expect(html).toContain('Statutory figures');
    expect(html).toContain('not been verified against the authority');
  });

  it('5. an uncalculated statutory figure prints "Not calculated" and NEVER 0.00', () => {
    // Zero says nothing is owed. Blank says nobody worked it out. On a
    // statutory document those are different statements.
    const line = { ...LINE, epfEmployee: null, epfEmployer: null };
    const html = renderPayslipHtml(
      { ...RUN, statutoryStatus: 'NOT_CONFIGURED', statutoryNotice: 'No statutory rates were configured.' },
      line,
      CONTEXT,
    );
    const epfRow = html.slice(html.indexOf('EPF (employee)'), html.indexOf('SOCSO (employee)'));
    expect(epfRow).toContain('Not calculated');
    expect(epfRow).not.toContain('0.00');
    expect(html).toContain('not a complete statement of deductions');
  });

  it('6. the reason a figure is missing is printed beside it', () => {
    const line = {
      ...LINE,
      epfEmployee: null,
      breakdown: { statutoryNotes: { epf: 'No EPF band table for this period' } },
    };
    expect(renderPayslipHtml(RUN, line, CONTEXT)).toContain('No EPF band table for this period');
  });

  it('7. PCB entered by hand says it was entered by hand', () => {
    const line = {
      ...LINE,
      breakdown: { statutoryNotes: { pcb: 'PCB of RM45.00 was entered by hand, not calculated.' } },
    };
    expect(renderPayslipHtml(RUN, line, CONTEXT)).toContain('entered by hand, not calculated');
  });

  it('8. an employee outside a scheme reads "Not applicable", not "Not calculated"', () => {
    // A fact about the employee, not about the system. The two must not read
    // the same on a document somebody may query.
    const line = {
      ...LINE,
      eisEmployee: null,
      snapshot: { ...LINE.snapshot!, statutoryApplicability: { epf: true, socso: true, eis: false, pcb: true } },
    };
    const resolved = employeeStatutory(line);
    expect(resolved.find((item) => item.label === 'EIS (employee)')!.applicable).toBe(false);
    const html = renderPayslipHtml(RUN, line, CONTEXT);
    expect(html).toContain('Not applicable to this employee');
    // And it is not counted as an incomplete deduction.
    expect(payslipTotals(line).uncalculated).toBe(0);
  });
});

describe('the slip checks its own arithmetic', () => {
  it('9. gross less the printed deductions equals the printed net', () => {
    const totals = payslipTotals(LINE);
    expect(totals.deductions).toBe(436.95);
    expect(totals.derivedNet).toBe(2913.05);
    expect(totals.adds).toBe(true);
  });

  it('10. a slip that does not add up refuses to show a net, and says why', () => {
    // Somebody will pay whatever the net says, so a net that does not follow
    // from the figures above it is the one thing this document must not print.
    const line = { ...LINE, netPay: 3000 };
    const totals = payslipTotals(line);
    expect(totals.adds).toBe(false);

    const html = renderPayslipHtml(RUN, line, CONTEXT);
    expect(html).toContain('These figures do not add up');
    expect(html).toContain('not safe to issue');
  });

  it('11. unpaid leave and other deductions are inside the total', () => {
    const line = { ...LINE, unpaidLeaveDeduction: 115.38, otherDeductions: 50, netPay: 2747.67 };
    const totals = payslipTotals(line);
    expect(totals.deductions).toBe(602.33);
    expect(totals.adds).toBe(true);
  });

  it('12. employer contributions are shown but never deducted', () => {
    const html = renderPayslipHtml(RUN, LINE, CONTEXT);
    expect(html).toContain('not deducted from your pay');
    // The employer's EPF is on the page and out of the deduction total.
    expect(html).toContain('435.50');
    expect(payslipTotals(LINE).deductions).toBe(436.95);
  });
});

describe('what a payslip must not leak or invent', () => {
  it('13. the bank ACCOUNT NUMBER is not on the slip — only the bank', () => {
    const html = renderPayslipHtml(RUN, LINE, CONTEXT);
    expect(html).toContain('Bank Contoh');
    // It is not snapshotted at all, so there is nothing here to print.
    expect(html).not.toMatch(/account\s*(no|number)/i);
  });

  it('14. it prints the FROZEN snapshot, not today’s employee record', () => {
    // A payslip must keep saying what it said after somebody is promoted.
    const line = { ...LINE, name: 'Nurul Huda (Senior Nurse)' };
    expect(renderPayslipHtml(RUN, line, CONTEXT)).toContain('Staff Nurse');
  });

  it('15. an employee name with markup in it cannot break out of the document', () => {
    const line = { ...LINE, snapshot: { ...LINE.snapshot!, name: '<script>alert(1)</script>' } };
    const html = renderPayslipHtml(RUN, line, CONTEXT);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('16. it says who printed it and when, because payslips get reprinted', () => {
    const html = renderPayslipHtml(RUN, LINE, CONTEXT);
    expect(html).toContain('by Dr Aisyah Rahman');
    expect(html).toContain('computer-generated statement of wages');
  });
});
