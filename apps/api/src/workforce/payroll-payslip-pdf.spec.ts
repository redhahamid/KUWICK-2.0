import { renderPayslipPdf } from './payroll-payslip-pdf';
import { addressAsRecorded, type PayslipData } from './payroll-payslip.service';

/*
 * THE PAYSLIP PDF LAYOUT (UAT, 12 October 2026): a long name prints whole, a
 * month paid on three dates gets its Date | Amount table, the year to date
 * prints, and it all stays on one page. Demo people and figures only.
 */
const slip = (over: Partial<PayslipData> = {}): PayslipData =>
  ({
    runId: 'run-1',
    period: '2026-01',
    periodLabel: 'January 2026',
    runType: 'REGULAR',
    sequence: 1,
    paymentDate: null,
    runStatus: 'APPROVED',
    statutoryStatus: 'VERIFIED',
    clinicName: 'Demo Branch',
    revision: { version: 1, of: 1, approvedAt: '2026-02-01T00:00:00.000Z', approvedBy: ['Demo Owner'], superseded: false, reopenedSinceApproval: false },
    verification: { verdict: 'VERIFIED', hash: 'a'.repeat(64), schemaVersion: 5 },
    employer: {
      name: 'Demo Klinik Sdn Bhd',
      logoMediaId: null,
      registrationNo: '202601012345',
      epfEmployerNo: 'EPF-1',
      socsoEmployerNo: 'SOCSO-1',
      lhdnEmployerNo: 'E-1',
      addressLines: ['No. 1, Jalan Demo', '43000 Kajang', 'Selangor'],
      detailsAsAt: 'CURRENT',
    },
    employee: {
      staffId: 's-1',
      name: 'DR MUHAMMAD DEMO BIN ABDULLAH AL-CONTOH SYAHRUL NIZAM',
      employeeNo: 'EM-1001',
      position: 'Medical Officer',
      department: null,
      employmentType: 'PERMANENT',
      bankName: 'Maybank',
      bankAccountLastFour: '8901',
      epfNumber: 'EPF-123',
      socsoNumber: 'SOCSO-456',
      taxNumber: null,
      identifier: null,
      identifiersAsAt: 'CURRENT',
    },
    preparedBy: { name: 'Demo Owner', position: null, at: '2026-02-01T00:00:00.000Z' },
    approvedBy: { name: 'Demo Owner', position: null, at: '2026-02-01T00:00:00.000Z' },
    paidAt: null,
    netInWords: 'Ringgit Malaysia Five Thousand Only',
    hrdLevyCents: null,
    attendance: { workedDays: 22, unpaidDays: 0, overtimeHours: 0 },
    itemised: true,
    earnings: [
      { code: 'BASIC', label: 'Basic pay', amountCents: 400000, payDate: '2026-01-30' },
      { code: 'NIGHT_INCENTIVE', label: 'Night incentive (December 2025)', amountCents: 60000, payDate: '2026-01-15' },
      { code: 'DIRECTOR_FEE', label: "Director's fee", amountCents: 100000, payDate: '2026-01-01' },
    ],
    payments: [
      { date: '2026-01-01', amountCents: 100000, paidOn: null },
      { date: '2026-01-15', amountCents: 60000, paidOn: null },
      { date: '2026-01-30', amountCents: 340000, paidOn: null },
    ],
    wageReductions: [],
    otherDeductionLines: [],
    overtimeDetail: null,
    statutoryDeductions: [
      { key: 'EPF', label: 'EPF (employee)', amountCents: 44000, applicable: true, note: null },
      { key: 'PCB', label: 'PCB / MTD', amountCents: 16000, applicable: true, note: null },
    ],
    employerContributions: [{ key: 'EPF', label: 'EPF (employer)', amountCents: 52000 }],
    figures: {
      salaryBasis: null,
      salaryAmountCents: 400000,
      grossCents: 560000,
      deductionCents: 60000,
      netCents: 500000,
      employerContributionCents: 52000,
      employerCostCents: 612000,
      derivedNetCents: 500000,
      adds: true,
    },
    bases: { epfCents: 400000, socsoCents: 400000, eisCents: 400000 },
    statutoryNotes: null,
    classification: null,
    schedules: [],
    ytd: { months: 1, importedMonths: 0, grossCents: 560000, epfEmployeeCents: 44000, socsoEmployeeCents: 0, eisEmployeeCents: 0, lindungEmployeeCents: 0, pcbCents: 16000, zakatCents: 0 },
    ...over,
  }) as unknown as PayslipData;

describe('the payslip PDF', () => {
  it('renders a busy month on one page', async () => {
    const pdf = await renderPayslipPdf(slip());
    if (process.env.PAYSLIP_PDF_OUT) require('fs').writeFileSync(process.env.PAYSLIP_PDF_OUT, pdf);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
  });

  it('renders with no year to date, cash pay and one pay date', async () => {
    const pdf = await renderPayslipPdf(
      slip({ ytd: null, payments: [{ date: '2026-01-30', amountCents: 500000, paidOn: null }], employee: { ...slip().employee, bankName: null, bankAccountLastFour: null } }),
    );
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
  });

  it('falls back to the initial when the logo cannot be read', async () => {
    await expect(renderPayslipPdf(slip(), Buffer.from('not an image'))).resolves.toBeInstanceOf(Buffer);
  });
});

describe('the employer address as recorded', () => {
  it('prints the lines as typed, adding postcode, city and state only where they are not already said', () => {
    expect(
      addressAsRecorded({ addressLine1: 'No. 1, Jalan Demo', addressLine2: '43000 Kajang', postcode: '43000', city: 'Kajang', state: 'Selangor' }),
    ).toEqual(['No. 1, Jalan Demo', '43000 Kajang', 'Selangor']);
    expect(addressAsRecorded({ addressLine1: 'No. 1, Jalan Demo, Bangi, Selangor', postcode: '43650', city: 'Bangi', state: 'Selangor' })).toEqual([
      'No. 1, Jalan Demo, Bangi, Selangor',
      '43650',
    ]);
    expect(addressAsRecorded({ addressLine1: 'No. 1', postcode: '43650', city: 'Bandar Baru Bangi', state: 'Selangor' })).toEqual([
      'No. 1',
      '43650 Bandar Baru Bangi',
      'Selangor',
    ]);
  });
});
