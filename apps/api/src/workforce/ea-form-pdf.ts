import PDFDocument from 'pdfkit';
import type { EaForm } from './ea-form.service';
import { remunerationCents } from './ea-form.service';
import { LAYOUT } from './ea-layout/cp8a-pin2017';

/**
 * BORANG EA DRAWN FROM THE AUDITOR'S TEMPLATE (15 October 2026).
 *
 * The page is the template itself: `ea-layout/cp8a-pin2017.ts` is generated
 * from docs/templates/EA_Pin2017_1.xlsx (C.P.8A, Malay) with its column
 * widths, row heights, merged cells, borders, shading and wording, printed at
 * the template's own scale on A4. This file draws that geometry and writes the
 * year's figures into the template's boxes, named by cell below. Nothing here
 * calculates; every figure arrives worked out from approved payroll.
 *
 * A newer revision: regenerate the layout from the new spreadsheet, check the
 * cells in FIELDS still point at the right boxes, and update the version label
 * in the clinic's settings (Reports → EA forms).
 */

type Layout = typeof LAYOUT;
type LayoutCell = Layout['cells'][number];

const PAGE = { width: 595.28, height: 841.89 };
const BORDER_WIDTH: Record<string, number> = { thin: 0.75, medium: 1.5 };
const PAD = 1.5;

/** Which template box each figure goes in (top-left cell of the box). */
type Fill = { text: string; align?: 'left' | 'right' | 'center' };

const money = (cents: number) =>
  `${cents < 0 ? '-' : ''}${(Math.abs(cents) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/**
 * THE ZERO RULE, from the auditor's own filled 2024 sample (15 October 2026):
 * every right-hand RM box prints its figure, "0.00" when nil. The few boxes
 * the auditor leaves empty when nil (D4's two RM boxes, E's) use `ifAny`.
 */
const amount = (cents: number): Fill => ({ text: money(cents), align: 'right' });
const ifAny = (cents: number): Fill | null => (cents === 0 ? null : amount(cents));
const dayMonthYear = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

export function eaFields(form: EaForm): Record<string, Fill | null> {
  const b = form.boxes;
  const passport = form.employee.idType === 'PASSPORT';
  const text = (value: string | null | undefined): Fill | null => (value ? { text: value } : null);
  return {
    // Header
    A1: { text: form.versionLabel },
    E3: text(form.serialNo),
    E4: text(form.employer.lhdnEmployerNo),
    Z4: { text: String(form.year), align: 'center' },
    AE3: text(form.employee.taxNumber),
    AK4: null, // Cawangan LHDNM: the employee's tax branch, not held by Kuwick; filled by hand.
    // A. Butiran pekerja
    Q10: text(form.employee.name),
    F12: text(form.employee.position),
    AI12: text(form.employee.employeeNo),
    H13: passport ? null : text(form.employee.idNumber),
    AI13: passport ? text(form.employee.idNumber) : null,
    H14: text(form.employee.epfNumber),
    AI14: text(form.employee.socsoNumber),
    K16: { text: String(form.qualifyingChildren), align: 'center' },
    AI16: text(dayMonthYear(form.employee.startDate)),
    AI17: text(dayMonthYear(form.employee.endDate)),
    // B. Pendapatan penggajian
    AK22: amount(b.B1a),
    AK23: amount(b.B1b),
    AC24: text((form.labels.B1c ?? []).join(', ')),
    AK24: amount(b.B1c),
    AK25: amount(b.B1d),
    AK26: amount(b.B1e),
    AK27: amount(b.B1f),
    AK31: amount(b.B2),
    O33: text((form.labels.B3 ?? []).join(', ')),
    AK33: amount(b.B3),
    AK35: amount(b.B4),
    AK37: amount(b.B5),
    AK39: amount(b.B6),
    // C. Pencen — none through payroll; JUMLAH is Part B and C together.
    AK42: amount(0),
    AK43: amount(0),
    AK44: { text: money(remunerationCents(form)), align: 'right' },
    // D. Potongan
    AK47: amount(form.pcbCents),
    AK48: amount(form.cp38Cents),
    AK49: amount(form.zakatCents),
    Z51: ifAny(form.tp1ReliefCents),
    Z52: null,
    // D5: left blank until the auditor confirms whether it is a count of children or RM.
    AK54: null,
    // E. Caruman pekerja
    J57: form.epfCents > 0 ? { text: 'KUMPULAN WANG SIMPANAN PEKERJA' } : null,
    AJ58: ifAny(form.epfCents),
    AJ59: ifAny(form.socsoCents),
    // F. Dikecualikan cukai
    AJ61: amount(b.F),
    // Tandatangan: the employer's signing officer and position, and the issue date.
    X64: text(form.employer.signerName),
    X66: text(form.employer.signerPosition),
    C72: text(dayMonthYear(form.issueDate)),
    X68: text(form.employer.name),
    X69: text(form.employer.addressLines[0]),
    X70: text(form.employer.addressLines[1]),
    X72: text(form.employer.phone),
  };
}

export function renderEaFormsPdf(forms: EaForm[], title?: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: title ?? 'Borang EA' } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  if (forms.length === 0) doc.addPage();
  for (const form of forms) {
    doc.addPage();
    drawPage(doc, LAYOUT, eaFields(form));
  }
  doc.end();
  return done;
}

/** The blank template, for checking the drawing against the spreadsheet. */
export function renderEaTemplatePdf(): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: 'Borang EA (blank)' } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  drawPage(doc, LAYOUT, {});
  doc.end();
  return done;
}

function drawPage(doc: PDFKit.PDFDocument, layout: Layout, fields: Record<string, Fill | null>) {
  const s = layout.scale;
  const xs = [0];
  for (const w of layout.colWidthsPt) xs.push(xs[xs.length - 1] + w);
  const ys = [0];
  for (const h of layout.rowHeightsPt) ys.push(ys[ys.length - 1] + h);
  const left = layout.marginsPt.left;
  // CENTRED ON THE ROWS IN USE, so a 100% print keeps clear of the printer's
  // unprintable edge: the template's empty rows below Part F used to push the
  // form to 6 pt from the top of the A4 sheet.
  const lastRow = Math.max(...layout.cells.map((cell) => cell.r2), ...layout.borders.map((border) => border.r));
  const top = Math.max(layout.marginsPt.top, (PAGE.height - ys[lastRow + 1] * s) / 2);
  const X = (c: number) => left + xs[c] * s;
  const Y = (r: number) => top + ys[r] * s;
  const rect = (cell: LayoutCell) => ({ x: X(cell.c), y: Y(cell.r), w: X(cell.c2 + 1) - X(cell.c), h: Y(cell.r2 + 1) - Y(cell.r) });

  // 1. Shading: black section bars, light-blue entry boxes.
  for (const cell of layout.cells) {
    if (!cell.fill) continue;
    const box = rect(cell);
    doc.rect(box.x, box.y, box.w, box.h).fill(`#${cell.fill}`);
  }

  // A vertical line under text that runs on past its cell is left out, as on
  // the printed template ("No. Kakitangan/No. Gaji", auditor's review 15 October 2026).
  const underText = new Set<string>();
  for (const cell of layout.cells) {
    if (!cell.text || cell.wrap || cell.c !== cell.c2 || cell.r !== cell.r2 || (cell.h && cell.h !== 'left')) continue;
    doc.font(cell.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(sizeOf(cell) * s);
    const end = X(cell.c) + PAD + doc.widthOfString(cell.text);
    for (let k = cell.c + 1; k < xs.length && X(k) < end; k += 1) underText.add(`${cell.r}:${k}`);
  }

  // 2. Borders, side by side as the spreadsheet draws them.
  for (const border of layout.borders) {
    const x1 = X(border.c);
    const x2 = X(border.c + 1);
    const y1 = Y(border.r);
    const y2 = Y(border.r + 1);
    const line = (style: string | undefined, ax: number, ay: number, bx: number, by: number) => {
      if (!style) return;
      doc.moveTo(ax, ay).lineTo(bx, by).lineWidth((BORDER_WIDTH[style] ?? 0.75) * s).strokeColor('#000000').stroke();
    };
    const sides = border as { left?: string; right?: string; top?: string; bottom?: string };
    line(sides.top, x1, y1, x2, y1);
    line(sides.bottom, x1, y2, x2, y2);
    if (!underText.has(`${border.r}:${border.c}`)) line(sides.left, x1, y1, x1, y2);
    if (!underText.has(`${border.r}:${border.c + 1}`)) line(sides.right, x2, y1, x2, y2);
  }

  // 3. The template's own wording, then the figures in their boxes.
  for (const cell of layout.cells) {
    const fill = fields[cell.ref];
    if (fill !== undefined && cell.ref !== 'A1') continue;
    const value = cell.ref === 'A1' && fill ? fill.text : cell.text;
    if (!value) continue;
    const spill = cell.c === cell.c2 && cell.r === cell.r2;
    write(doc, rect(cell), value, {
      size: sizeOf(cell) * s,
      bold: cell.bold,
      color: cell.color ? `#${cell.color}` : '#000000',
      align: (cell.h as 'left' | 'center' | 'right' | null) ?? 'left',
      valign: (cell.v as 'top' | 'center' | 'bottom' | null) ?? 'bottom',
      wrap: cell.wrap,
      spill,
      // A box's own wording stays inside the box: "BAGI TAHUN BERAKHIR 31 DISEMBER" ran into the year.
      shrink: !spill && !cell.wrap,
    });
  }
  const boxes = new Map<string, LayoutCell>(layout.cells.map((cell) => [cell.ref, cell]));
  for (const [ref, fill] of Object.entries(fields)) {
    const cell = boxes.get(ref);
    if (!cell || !fill || ref === 'A1') continue;
    write(doc, rect(cell), fill.text, {
      size: 8 * s,
      bold: false,
      color: '#000000',
      align: fill.align ?? 'left',
      valign: 'center',
      wrap: false,
      spill: false,
      shrink: true,
    });
  }
}

/** Item numerals ("1.", "2.") all print at the template's usual size; one "2." in Part E was set larger. */
function sizeOf(cell: LayoutCell): number {
  return cell.text && /^\d+\.$/.test(cell.text) ? 8 : cell.size;
}

function write(
  doc: PDFKit.PDFDocument,
  box: { x: number; y: number; w: number; h: number },
  text: string,
  options: { size: number; bold: boolean; color: string; align: 'left' | 'center' | 'right'; valign: 'top' | 'center' | 'bottom'; wrap: boolean; spill: boolean; shrink?: boolean },
) {
  let size = options.size;
  doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica');
  // A long name in a box: smaller type rather than past the border.
  while (options.shrink && size > 4 && doc.fontSize(size).widthOfString(text) > box.w - 2 * PAD) size -= 0.25;
  doc.fontSize(size).fillColor(options.color);
  // Wrapped wording that would spill out of its box is made smaller instead,
  // down to one line: the black bar "BORANG EA INI PERLU…" fits as on the template.
  while (options.wrap && size > 4 && doc.fontSize(size).heightOfString(text, { width: box.w - 2 * PAD }) > box.h) size -= 0.25;
  doc.fontSize(size);
  const lineHeight = doc.currentLineHeight();
  if (options.wrap) {
    const height = doc.heightOfString(text, { width: box.w - 2 * PAD });
    doc.text(text, box.x + PAD, box.y + Math.max(0, (box.h - height) / 2), { width: box.w - 2 * PAD, align: options.align });
    return;
  }
  const width = doc.widthOfString(text);
  // Spreadsheet text runs on past a single cell's edge; centred text spreads both ways.
  const x =
    options.align === 'right'
      ? box.x + box.w - PAD - width
      : options.align === 'center'
        ? box.x + (box.w - width) / 2
        : box.x + PAD;
  const y = options.valign === 'top' ? box.y + 0.5 : options.valign === 'center' ? box.y + (box.h - lineHeight) / 2 + 0.5 : box.y + box.h - lineHeight;
  doc.text(text, x, y, { lineBreak: false });
}
