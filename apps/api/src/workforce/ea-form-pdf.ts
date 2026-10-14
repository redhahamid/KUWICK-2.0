import PDFDocument from 'pdfkit';
import type { EaForm } from './ea-form.service';
import { remunerationCents } from './ea-form.service';
import type { EaBox } from './ea-form';

/**
 * BORANG EA ON A4, one page per person, in the order and wording of LHDN's
 * C.P.8A (Malay first, English under it). Every figure arrives worked out;
 * this file only places it. A missing number prints as a blank line to fill
 * in by hand, never as a made-up value.
 */

const RM = (cents: number) =>
  `${cents < 0 ? '-' : ''}${(Math.abs(cents) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const INK = '#000000';
const FAINT = '#555555';

/** Part B and F rows: the box, the Malay line, the English line. */
const ROWS: { box: EaBox; ms: string; en: string }[] = [
  { box: 'B1a', ms: '1. (a) Gaji kasar, upah atau gaji cuti (termasuk gaji lebih masa)', en: 'Gross salary, wages or leave pay (including overtime pay)' },
  { box: 'B1b', ms: '(b) Fi (termasuk fi pengarah), komisen atau bonus', en: 'Fees (including director fees), commission or bonus' },
  { box: 'B1c', ms: '(c) Tip kasar, perkuisit, penerimaan sagu hati atau elaun-elaun lain', en: 'Gross tips, perquisites, awards/rewards or other allowances' },
  { box: 'B1d', ms: '(d) Cukai pendapatan yang dibayar oleh majikan bagi pihak pekerja', en: 'Income tax borne by the employer in respect of the employee' },
  { box: 'B1e', ms: '(e) Manfaat Skim Opsyen Saham Pekerja (ESOS)', en: 'Employee Share Option Scheme (ESOS) benefit' },
  { box: 'B1f', ms: '(f) Ganjaran', en: 'Gratuity' },
  { box: 'B2', ms: '2. Butiran bayaran tunggakan dan lain-lain bagi tahun-tahun terdahulu', en: 'Arrears and others for preceding years paid in the current year' },
  { box: 'B3', ms: '3. Manfaat berupa barangan', en: 'Benefits in kind' },
  { box: 'B4', ms: '4. Nilai tempat kediaman yang disediakan oleh majikan', en: 'Value of living accommodation provided by the employer' },
  { box: 'B5', ms: '5. Bayaran balik daripada Kumpulan Wang Simpanan/Pencen yang tidak diluluskan', en: 'Refund from unapproved Provident/Pension Fund' },
  { box: 'B6', ms: '6. Pampasan kerana kehilangan pekerjaan', en: 'Compensation for loss of employment' },
];

export function renderEaFormsPdf(forms: EaForm[], title?: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 36, autoFirstPage: false, info: { Title: title ?? 'Borang EA' } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  if (forms.length === 0) doc.addPage();
  for (const form of forms) {
    doc.addPage();
    drawForm(doc, form);
  }
  doc.end();
  return done;
}

function drawForm(doc: PDFKit.PDFDocument, form: EaForm) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const amountX = right - 90;
  let y = doc.page.margins.top;

  const text = (value: string, x: number, at: number, options: PDFKit.Mixins.TextOptions & { size?: number; bold?: boolean; color?: string } = {}) => {
    doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(options.size ?? 8).fillColor(options.color ?? INK).text(value, x, at, options);
  };
  const rule = (at: number) => doc.moveTo(left, at).lineTo(right, at).lineWidth(0.5).strokeColor(INK).stroke();
  const heading = (value: string) => {
    y += 4;
    doc.rect(left, y, width, 13).fill('#e6e6e6');
    text(value, left + 4, y + 3, { bold: true });
    y += 17;
  };
  const amountRow = (ms: string, en: string, cents: number | null, indent = 0) => {
    text(ms, left + 4 + indent, y, { width: amountX - left - 12 - indent });
    text(en, left + 4 + indent, y + 9, { width: amountX - left - 12 - indent, color: FAINT, size: 7 });
    text(cents === null ? '' : RM(cents), amountX, y + 4, { width: 86, align: 'right' });
    y += 17;
  };
  const field = (ms: string, en: string, value: string | null, x: number, w: number, at: number) => {
    text(`${ms} / ${en}`, x, at, { width: w, color: FAINT, size: 7 });
    text(value ?? '______________________', x, at + 9, { width: w, bold: Boolean(value) });
  };

  // --- Header ---------------------------------------------------------------
  text('C.P.8A', left, y, { bold: true });
  text('Malaysia — Cukai Pendapatan', left, y + 10, { size: 7, color: FAINT });
  text('EA', right - 40, y, { width: 40, align: 'right', size: 18, bold: true });
  text(`No. Majikan E: ${form.employer.lhdnEmployerNo ?? '____________'}`, left + 150, y, { width: width - 200, align: 'center', bold: true });
  y += 22;
  text('PENYATA SARAAN DARIPADA PENGGAJIAN', left, y, { width, align: 'center', bold: true, size: 10 });
  text('STATEMENT OF REMUNERATION FROM EMPLOYMENT', left, y + 12, { width, align: 'center', size: 8 });
  text(`BAGI TAHUN BERAKHIR 31 DISEMBER ${form.year} / FOR THE YEAR ENDED 31 DECEMBER ${form.year}`, left, y + 23, { width, align: 'center', bold: true });
  y += 38;
  text(
    'BORANG EA INI PERLU DISEDIAKAN UNTUK DISERAHKAN KEPADA PEKERJA BAGI TUJUAN CUKAI PENDAPATANNYA / THIS FORM EA MUST BE PREPARED AND PROVIDED TO THE EMPLOYEE FOR INCOME TAX PURPOSE',
    left,
    y,
    { width, align: 'center', size: 6.5, color: FAINT },
  );
  y += 18;
  field('No. Cukai Pendapatan Pekerja', "Employee's Income Tax No.", form.employee.taxNumber, left, width / 2 - 8, y);
  y += 20;
  rule(y);

  // --- A: employee ----------------------------------------------------------
  heading('A  BUTIRAN PEKERJA / PARTICULARS OF EMPLOYEE');
  const half = width / 2 - 8;
  field('Nama penuh pekerja/pesara', 'Full name of employee/pensioner', form.employee.name, left + 4, width - 8, y);
  y += 22;
  field('Jawatan', 'Job designation', form.employee.position, left + 4, half, y);
  field('No. kakitangan/gaji', 'Staff/payroll number', form.employee.employeeNo, left + half + 12, half, y);
  y += 22;
  field(
    form.employee.idType === 'PASSPORT' ? 'No. pasport' : 'No. K.P. baru',
    form.employee.idType === 'PASSPORT' ? 'Passport no.' : 'New I.C. no.',
    form.employee.idNumber,
    left + 4,
    half,
    y,
  );
  field('No. KWSP', 'EPF no.', form.employee.epfNumber, left + half + 12, half, y);
  y += 22;
  field('No. PERKESO', 'SOCSO no.', form.employee.socsoNumber, left + 4, half, y);
  field('Anak layak pelepasan cukai', 'Children qualifying for tax relief', String(form.qualifyingChildren), left + half + 12, half, y);
  y += 22;
  if (form.employee.startDate || form.employee.endDate) {
    field('Tarikh mula berkhidmat', 'Date of commencement', form.employee.startDate, left + 4, half, y);
    field('Tarikh berhenti', 'Date of cessation', form.employee.endDate, left + half + 12, half, y);
    y += 22;
  }

  // --- B: employment income -------------------------------------------------
  heading('B  PENDAPATAN PENGGAJIAN, MANFAAT DAN TEMPAT KEDIAMAN / EMPLOYMENT INCOME AND BENEFITS');
  text('RM', amountX, y - 12, { width: 86, align: 'right', bold: true });
  for (const row of ROWS) amountRow(row.ms, row.en, form.boxes[row.box], row.ms.startsWith('(') ? 12 : 0);
  rule(y);
  y += 2;
  text('JUMLAH / TOTAL', left + 4, y + 2, { bold: true });
  text(RM(remunerationCents(form)), amountX, y + 2, { width: 86, align: 'right', bold: true });
  y += 14;

  // --- C: pension -----------------------------------------------------------
  heading('C  PENCEN DAN LAIN-LAIN / PENSION AND OTHERS');
  amountRow('1. Pencen', 'Pension', 0);
  amountRow('2. Anuiti atau Bayaran Berkala yang lain', 'Annuities or other periodical payments', 0);

  // --- D: deductions --------------------------------------------------------
  heading('D  JUMLAH POTONGAN / TOTAL DEDUCTION');
  amountRow('1. Potongan Cukai Bulanan (PCB) yang dibayar kepada LHDNM', 'Monthly tax deductions (MTD) remitted to LHDNM', form.pcbCents);
  amountRow('2. Arahan Potongan CP 38', 'CP 38 deductions', form.cp38Cents);
  amountRow('3. Zakat yang dibayar melalui potongan gaji', 'Zakat paid via salary deduction', form.zakatCents);
  amountRow('4. Jumlah tuntutan potongan oleh pekerja melalui Borang TP1', 'Total claim for relief by employee via Form TP1', form.tp1ReliefCents);

  // --- E: contributions -----------------------------------------------------
  heading('E  CARUMAN YANG DIBAYAR OLEH PEKERJA / CONTRIBUTIONS PAID BY EMPLOYEE');
  amountRow('1. Kumpulan Wang Simpanan Pekerja (KWSP) — caruman wajib', 'Employees Provident Fund (EPF) — compulsory contribution', form.epfCents);
  amountRow('2. PERKESO dan SIP — bahagian pekerja sahaja', 'SOCSO and EIS — employee’s share only', form.socsoCents);

  // --- F: exempt ------------------------------------------------------------
  heading('F  ELAUN / PERKUISITE / PEMBERIAN / MANFAAT YANG DIKECUALIKAN CUKAI / TAX-EXEMPT');
  amountRow('Jumlah yang dikecualikan cukai', 'Total tax-exempt allowances / perquisites / gifts / benefits', form.boxes.F);

  // --- Signature block ------------------------------------------------------
  y += 6;
  field('Nama dan alamat majikan', 'Name and address of employer', [form.employer.name, form.employer.address].filter(Boolean).join(', '), left + 4, half, y);
  field('Nama pegawai', 'Name of officer', null, left + half + 12, half / 2 - 4, y);
  field('Tarikh', 'Date', null, left + half + 12 + half / 2, half / 2 - 4, y);

  text(
    `Prepared by Kuwick from approved payroll for ${form.year}. Check against LHDN's current C.P.8A before giving it to the employee.`,
    left,
    doc.page.height - doc.page.margins.bottom - 12,
    { width, align: 'center', size: 6.5, color: FAINT },
  );
}
