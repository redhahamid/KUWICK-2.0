import { defaultEaBox, eaBoxOf, eaFigures, EaItem } from './ea-form';
import { eaFields, renderEaFormsPdf } from './ea-form-pdf';
import { LAYOUT } from './ea-layout/cp8a-pin2017';
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

  it('prints one page per person on the template, with the figures in its boxes', async () => {
    const form = demoForm();
    const fields = eaFields(form);
    // Header, Part A, Part B and the totals land in the template's own boxes.
    expect(fields.A1?.text).toBe('(C.P.8A - Pin. 2017)');
    expect(fields.AE3?.text).toBe('IG 00000000000');
    expect(fields.Q10?.text).toBe('Demo Jururawat Satu');
    expect(fields.AK22).toEqual({ text: '32,400.00', align: 'right' });
    expect(fields.AC24?.text).toBe('Elaun perjalanan');
    expect(fields.AK44?.text).toBe('35,100.00');
    expect(fields.AK47?.text).toBe('860.00');
    expect(fields.J57?.text).toBe('KUMPULAN WANG SIMPANAN PEKERJA');
    // The zero rule (auditor's 2024 sample): right-hand RM boxes print 0.00 when
    // nil; D4's RM boxes and D5 stay blank (D5 waits on the auditor).
    for (const ref of ['AK25', 'AK26', 'AK27', 'AK31', 'AK33', 'AK35', 'AK37', 'AK39', 'AK42', 'AK43', 'AK48', 'AK49']) {
      expect([ref, fields[ref]]).toEqual([ref, { text: '0.00', align: 'right' }]);
    }
    expect(fields.Z51).toBeNull();
    expect(fields.Z52).toBeNull();
    expect(fields.AK54).toBeNull();
    // The signing officer, the position and the issue date.
    expect(fields.X64?.text).toBe('Demo Pengarah');
    expect(fields.X66?.text).toBe('PENGARAH');
    expect(fields.C72?.text).toBe('31/12/2026');
    // Every box named is a box on the template.
    const refs = new Set(LAYOUT.cells.map((cell) => cell.ref as string));
    expect(Object.keys(fields).filter((ref) => !refs.has(ref))).toEqual([]);
    const pdf = await renderEaFormsPdf([form, { ...form, staffId: 's2' }]);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(2);
  });

});

/** A demo person, made-up figures. */
export function demoForm(): EaForm {
  return {
    staffId: 's1',
    legalEmployerId: 'e1',
    year: 2026,
    serialNo: '2026/0001',
    versionLabel: '(C.P.8A - Pin. 2017)',
    employer: {
      name: 'Klinik Demo Baru Sdn Bhd',
      lhdnEmployerNo: 'E 9999999999',
      address: 'No. 1, Jalan Demo, 43000 Kajang, Selangor',
      addressLines: ['No. 1, Jalan Demo', '43000 Kajang, Selangor'],
      phone: '03-0000 0000',
      signerName: 'Demo Pengarah',
      signerPosition: 'PENGARAH',
    },
    issueDate: '2026-12-31',
    employee: {
      name: 'Demo Jururawat Satu',
      employeeNo: 'D-001',
      position: 'Jururawat',
      idType: 'IC',
      idNumber: '000000-00-0000',
      taxNumber: 'IG 00000000000',
      epfNumber: '00000000',
      socsoNumber: '000000000000',
      startDate: '2026-03-01',
      endDate: null,
    },
    boxes: { B1a: 3240000, B1b: 150000, B1c: 120000, B1d: 0, B1e: 0, B1f: 0, B2: 0, B3: 0, B4: 0, B5: 0, B6: 0, F: 45000, NONE: 0 },
    labels: { B1a: ['Gaji pokok', 'Lebih masa'], B1b: ['Bonus'], B1c: ['Elaun perjalanan'], F: ['Tuntutan perubatan'] },
    pcbCents: 86000,
    cp38Cents: 0,
    zakatCents: 0,
    tp1ReliefCents: 0,
    qualifyingChildren: 1,
    epfCents: 386000,
    socsoCents: 21500,
    status: 'READY',
    problems: [],
  };
}
