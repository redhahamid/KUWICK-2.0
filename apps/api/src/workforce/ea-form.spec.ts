import { defaultEaBox, eaBoxOf, eaFigures, EaItem } from './ea-form';
import { renderEaFormsPdf } from './ea-form-pdf';
import type { EaForm } from './ea-form.service';

const item = (over: Partial<EaItem> & { code: string }): EaItem => ({
  type: 'ADDITION',
  category: 'REMUNERATION',
  includeIn: 'GROSS_AND_NET',
  pcbLiable: true,
  additionalRemuneration: false,
  eaField: null,
  ...over,
});

describe('EA form boxes (overnight brief, 15 October 2026)', () => {
  it('suggests a box from what the item is, and the item’s own box wins', () => {
    expect(defaultEaBox(item({ code: 'BASIC' }))).toBe('B1a');
    expect(defaultEaBox(item({ code: 'BONUS' }))).toBe('B1b');
    expect(defaultEaBox(item({ code: 'ALLOWANCE', category: 'ALLOWANCE' }))).toBe('B1c');
    expect(defaultEaBox(item({ code: 'CLAIM_REIMBURSEMENT', category: 'PERQUISITE', pcbLiable: false }))).toBe('F');
    expect(defaultEaBox(item({ code: 'UNPAID_LEAVE', type: 'DEDUCTION', includeIn: 'GROSS_ONLY' }))).toBe('B1a');
    expect(defaultEaBox(item({ code: 'UNIFORM', type: 'DEDUCTION', includeIn: 'NET_ONLY' }))).toBe('NONE');
    expect(eaBoxOf(item({ code: 'ALLOWANCE', category: 'ALLOWANCE', eaField: 'B1a' }))).toBe('B1a');
  });

  it('splits the year by box, takes unpaid leave off, and puts a totals-only month in B1(a)', () => {
    const items = new Map([
      ['BASIC', item({ code: 'BASIC' })],
      ['BONUS', item({ code: 'BONUS' })],
      ['UNPAID_LEAVE', item({ code: 'UNPAID_LEAVE', type: 'DEDUCTION', includeIn: 'GROSS_ONLY' })],
    ]);
    const figures = eaFigures(
      [
        { month: 1, grossCents: 300000, lines: null },
        {
          month: 2,
          grossCents: 340000,
          lines: [
            { code: 'BASIC', kind: 'EARNING', amountCents: 300000 },
            { code: 'BONUS', kind: 'EARNING', amountCents: 50000 },
            { code: 'UNPAID_LEAVE', kind: 'WAGE_REDUCTION', amountCents: 10000 },
            { code: 'PCB', kind: 'DEDUCTION', amountCents: 2000 },
          ],
        },
      ],
      items,
    );
    expect(figures.boxes.B1a).toBe(300000 + 300000 - 10000);
    expect(figures.boxes.B1b).toBe(50000);
    expect(figures.totalsOnlyMonths).toEqual([1]);
    expect(figures.differenceCents).toBe(0);
  });

  it('prints one page per person', async () => {
    const form = {
      staffId: 's1',
      legalEmployerId: 'e1',
      year: 2026,
      employer: { name: 'Klinik Demo Sdn Bhd', lhdnEmployerNo: 'E 1234567890', address: 'Jalan Demo, 43000 Kajang, Selangor' },
      employee: { name: 'Demo Staf Satu', employeeNo: 'D-1', position: 'Nurse', idType: 'IC', idNumber: '900101-10-1234', taxNumber: 'IG 12345678090', epfNumber: '12345678', socsoNumber: '900101101234', startDate: null, endDate: null },
      boxes: { B1a: 3600000, B1b: 0, B1c: 120000, B1d: 0, B1e: 0, B1f: 0, B2: 0, B3: 0, B4: 0, B5: 0, B6: 0, F: 0, NONE: 0 },
      pcbCents: 120000,
      cp38Cents: 0,
      zakatCents: 0,
      tp1ReliefCents: 0,
      qualifyingChildren: 2,
      epfCents: 396000,
      socsoCents: 21000,
      status: 'READY',
      problems: [],
    } as EaForm;
    const pdf = await renderEaFormsPdf([form, { ...form, staffId: 's2' }]);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(2);
  });
});
