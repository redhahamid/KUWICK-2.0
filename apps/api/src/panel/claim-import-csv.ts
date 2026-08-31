import { parseCsv } from '../inventory/seed-import';
import type { RowProblem } from '../inventory/inventory-csv';

/**
 * THE PANEL CLAIM IMPORT FORMAT (G-12).
 *
 * The last thing standing between the clinic and closing its claim workbook.
 * Kuwick cannot start empty on cutover day: the workbook holds thousands of
 * open and historical claims, a third of them unpaid, and every one of them is
 * money somebody is still owed.
 *
 * FIVE DECISIONS ABOUT THE SHAPE OF THIS TEMPLATE, all of them about not
 * producing bad data:
 *
 * 1. **ONE PANEL PER FILE.** A claim number means nothing without the panel
 *    that issued it, and a mixed file makes every duplicate check ambiguous.
 *    The panel is chosen in the UI, not typed in a column where it can vary
 *    row to row.
 *
 * 2. **THE FEE IS A COLUMN, and so is what the panel actually paid.** The
 *    workbook computes `CLAIM TO RECEIVE = CLAIMED − FEE` per sheet, and
 *    re-keys it by hand on the panels that matter. This template does NOT ask
 *    for the receivable: Kuwick derives it from claimed, fee and the panel's
 *    configured treatment, and a dry run shows the totals so the clinic can
 *    compare them against the workbook before committing. Asking for a figure
 *    Kuwick can compute is asking for two versions of it.
 *
 * 3. **STATUS IS A WORD FROM A LIST, not free text.** The workbook's status
 *    column carries dates, prose and blanks. Anything not on the list is a
 *    reported problem rather than a guess.
 *
 * 4. **A BLANK ADJUDICATION IS NOT ZERO.** `Approved Amount` left empty means
 *    the panel has not said, which is what `computeClaimBalance` needs to keep
 *    the receivable optimistic-but-labelled. Writing 0 says they refused it
 *    all. The two are different claims and the template must not merge them.
 *
 * 5. **THE PATIENT IS A REFERENCE, NOT A LOOKUP.** These visits happened in
 *    the system Kuwick replaces. The column takes whatever reference the
 *    clinic can still trace — a file number, an IC, a name — and Kuwick stores
 *    it as text without pretending it resolves to a patient record.
 */

export interface ClaimImportColumn {
  header: string;
  example: string;
  required?: boolean;
}

export const CLAIM_IMPORT_COLUMNS: ClaimImportColumn[] = [
  { header: 'Claim No', example: 'MC-2025-004417', required: true },
  { header: 'Service Date', example: '2025-11-04', required: true },
  { header: 'Patient Reference', example: 'FILE-20194', required: true },
  { header: 'Claimed Amount (RM)', example: '120.00', required: true },
  { header: 'Fee Amount (RM)', example: '9.60' },
  { header: 'Status', example: 'SUBMITTED', required: true },
  { header: 'Submitted Date', example: '2025-11-06' },
  { header: 'Adjudicated Date', example: '' },
  { header: 'Approved Amount (RM)', example: '' },
  { header: 'Rejected Amount (RM)', example: '' },
  { header: 'Rejection Reason', example: '' },
  { header: 'Paid Amount (RM)', example: '' },
  { header: 'Paid Date', example: '' },
  { header: 'Remarks', example: 'Awaiting the November remittance' },
];

/**
 * The statuses a row may carry. Deliberately the workbook's own vocabulary
 * mapped onto Kuwick's lifecycle, so the person filling the template is not
 * translating anything.
 */
export const CLAIM_IMPORT_STATUSES = [
  'SUBMITTED',
  'PARTIALLY_PAID',
  'PAID',
  'REJECTED',
  'WRITTEN_OFF',
] as const;

export type ClaimImportStatus = (typeof CLAIM_IMPORT_STATUSES)[number];

export interface ParsedClaimRow {
  line: number;
  claimNo: string;
  serviceDate: string;
  patientReference: string;
  claimedAmount: number;
  feeAmount: number;
  status: ClaimImportStatus;
  submittedDate: string | null;
  adjudicatedDate: string | null;
  /** NULL means the panel has not said, which is NOT zero. */
  approvedAmount: number | null;
  rejectedAmount: number | null;
  rejectionReason: string | null;
  paidAmount: number | null;
  paidDate: string | null;
  remarks: string | null;
}

export interface ParsedClaimCsv {
  rows: ParsedClaimRow[];
  problems: RowProblem[];
}

/**
 * The template, with three example rows rather than one.
 *
 * A claim that is merely submitted, one that was part-paid after a rejection,
 * and one that is closed. Between them they show every column's format,
 * including the two that matter most: a blank Approved Amount on a claim
 * nobody has adjudicated, and a filled one on a claim they part-approved.
 */
export function claimImportTemplate(): string {
  const header = CLAIM_IMPORT_COLUMNS.map((column) => column.header);
  const awaiting = CLAIM_IMPORT_COLUMNS.map((column) => column.example);
  const partial = CLAIM_IMPORT_COLUMNS.map((column) => {
    switch (column.header) {
      case 'Claim No':
        return 'MC-2025-004402';
      case 'Service Date':
        return '2025-10-18';
      case 'Patient Reference':
        return 'FILE-19822';
      case 'Claimed Amount (RM)':
        return '220.00';
      case 'Fee Amount (RM)':
        return '17.60';
      case 'Status':
        return 'PARTIALLY_PAID';
      case 'Submitted Date':
        return '2025-10-20';
      case 'Adjudicated Date':
        return '2025-11-02';
      case 'Approved Amount (RM)':
        return '180.00';
      case 'Rejected Amount (RM)':
        return '22.40';
      case 'Rejection Reason':
        return 'Consultation cap exceeded for this member';
      case 'Paid Amount (RM)':
        return '120.00';
      case 'Paid Date':
        return '2025-11-20';
      case 'Remarks':
        return 'Balance still being chased';
      default:
        return '';
    }
  });
  const settled = CLAIM_IMPORT_COLUMNS.map((column) => {
    switch (column.header) {
      case 'Claim No':
        return 'MC-2025-004390';
      case 'Service Date':
        return '2025-10-02';
      case 'Patient Reference':
        return 'FILE-19740';
      case 'Claimed Amount (RM)':
        return '120.00';
      case 'Fee Amount (RM)':
        return '9.60';
      case 'Status':
        return 'PAID';
      case 'Submitted Date':
        return '2025-10-03';
      case 'Adjudicated Date':
        return '2025-10-14';
      case 'Approved Amount (RM)':
        return '110.40';
      case 'Paid Amount (RM)':
        return '110.40';
      case 'Paid Date':
        return '2025-10-30';
      default:
        return '';
    }
  });
  return [header, awaiting, partial, settled].map(toCsvLine).join('\n') + '\n';
}

function toCsvLine(cells: string[]): string {
  return cells.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(',');
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse and validate the WHOLE file before anything is written.
 *
 * Nothing here touches the database. The service resolves the panel, checks
 * for claims already imported, and computes the money; this decides only
 * whether the file says what it appears to say.
 */
export function parseClaimImportCsv(text: string): ParsedClaimCsv {
  const records = parseCsv(text);
  const problems: RowProblem[] = [];
  const rows: ParsedClaimRow[] = [];
  const seenClaimNos = new Map<string, number>();

  records.forEach((record, index) => {
    // +2: one for the header, one because a spreadsheet's first row is 1.
    const line = index + 2;
    const before = problems.length;
    const cell = (header: string) => (record[header] ?? '').trim();

    const claimNo = cell('Claim No');
    if (!claimNo) {
      problems.push({ line, column: 'Claim No', message: 'A claim number is required — it is how the claim is identified when it is argued about.' });
    } else if (seenClaimNos.has(claimNo)) {
      // Importing the same claim twice would double the receivable, and the
      // clinic would have no way to tell which row was the real one.
      problems.push({
        line,
        column: 'Claim No',
        message: `"${claimNo}" is also on line ${seenClaimNos.get(claimNo)}. Each claim should appear once.`,
      });
    } else {
      seenClaimNos.set(claimNo, line);
    }

    const serviceDate = requireDate(cell('Service Date'), 'Service Date', line, problems);
    const patientReference = cell('Patient Reference');
    if (!patientReference) {
      problems.push({
        line,
        column: 'Patient Reference',
        message: 'Required — a claim nobody can trace back to a patient cannot be argued, resubmitted, or charged to anyone.',
      });
    }

    const claimedAmount = requireMoney(cell('Claimed Amount (RM)'), 'Claimed Amount (RM)', line, problems);
    const feeAmount = optionalMoney(cell('Fee Amount (RM)'), 'Fee Amount (RM)', line, problems) ?? 0;

    const statusRaw = cell('Status').toUpperCase().replace(/[\s-]+/g, '_');
    const status = (CLAIM_IMPORT_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as ClaimImportStatus)
      : null;
    if (!status) {
      problems.push({
        line,
        column: 'Status',
        message: `"${cell('Status')}" is not one of ${CLAIM_IMPORT_STATUSES.join(', ')}. A status Kuwick has to guess at is a claim nobody chases correctly.`,
      });
    }

    const submittedDate = optionalDate(cell('Submitted Date'), 'Submitted Date', line, problems);
    const adjudicatedDate = optionalDate(cell('Adjudicated Date'), 'Adjudicated Date', line, problems);
    const approvedAmount = optionalMoney(cell('Approved Amount (RM)'), 'Approved Amount (RM)', line, problems);
    const rejectedAmount = optionalMoney(cell('Rejected Amount (RM)'), 'Rejected Amount (RM)', line, problems);
    const paidAmount = optionalMoney(cell('Paid Amount (RM)'), 'Paid Amount (RM)', line, problems);
    const paidDate = optionalDate(cell('Paid Date'), 'Paid Date', line, problems);

    // --- Cross-column rules. Each one is a real workbook defect. ------------

    // A claim cannot be PAID with nothing recorded against it: the whole
    // reason for importing is to know what is still owed.
    if (status === 'PAID' && (paidAmount === null || paidAmount === 0)) {
      problems.push({
        line,
        column: 'Paid Amount (RM)',
        message: 'A PAID claim needs the amount that was actually banked. If the money has not arrived, the status is SUBMITTED.',
      });
    }
    if (status === 'PARTIALLY_PAID' && (paidAmount === null || paidAmount === 0)) {
      problems.push({
        line,
        column: 'Paid Amount (RM)',
        message: 'A PARTIALLY_PAID claim needs the amount received so far.',
      });
    }
    // A rejection with no reason is the workbook's commonest gap, and the one
    // that makes "why do we lose claims" unanswerable a year later.
    if (status === 'REJECTED' && !cell('Rejection Reason')) {
      problems.push({
        line,
        column: 'Rejection Reason',
        message: 'A rejected claim needs a reason. It does not have to be tidy — it has to exist.',
      });
    }
    // Money cannot be received against a claim that was never sent.
    if (paidAmount !== null && paidAmount > 0 && !submittedDate) {
      problems.push({
        line,
        column: 'Submitted Date',
        message: 'This claim has money against it but no submission date. A payment for a claim that was never sent is a data error, not a payment.',
      });
    }
    if (approvedAmount !== null && claimedAmount !== null && approvedAmount > claimedAmount) {
      problems.push({
        line,
        column: 'Approved Amount (RM)',
        message: `Approved ${approvedAmount.toFixed(2)} is more than the ${claimedAmount.toFixed(2)} claimed. A panel cannot approve more than it was asked for.`,
      });
    }
    if (paidAmount !== null && approvedAmount !== null && paidAmount > approvedAmount + 0.005 && status !== 'PAID') {
      problems.push({
        line,
        column: 'Paid Amount (RM)',
        message: `Paid ${paidAmount.toFixed(2)} exceeds the ${approvedAmount.toFixed(2)} approved.`,
      });
    }
    if (adjudicatedDate && submittedDate && adjudicatedDate < submittedDate) {
      problems.push({
        line,
        column: 'Adjudicated Date',
        message: 'The panel adjudicated before the claim was submitted.',
      });
    }

    if (problems.length !== before) return;

    rows.push({
      line,
      claimNo,
      serviceDate: serviceDate!,
      patientReference,
      claimedAmount: claimedAmount!,
      feeAmount,
      status: status!,
      submittedDate,
      adjudicatedDate,
      approvedAmount,
      rejectedAmount,
      rejectionReason: cell('Rejection Reason') || null,
      paidAmount,
      paidDate,
      remarks: cell('Remarks') || null,
    });
  });

  if (records.length === 0) {
    problems.push({ line: 1, column: 'Claim No', message: 'The file has no rows.' });
  }

  return { rows, problems };
}

function requireDate(value: string, column: string, line: number, problems: RowProblem[]): string | null {
  if (!value) {
    problems.push({ line, column, message: 'Required.' });
    return null;
  }
  return checkDate(value, column, line, problems);
}

function optionalDate(value: string, column: string, line: number, problems: RowProblem[]): string | null {
  if (!value) return null;
  return checkDate(value, column, line, problems);
}

function checkDate(value: string, column: string, line: number, problems: RowProblem[]): string | null {
  if (!ISO_DATE.test(value)) {
    // A spreadsheet will happily hand over "4/11/25", which is the 4th of
    // November or the 11th of April depending on who exported it. Kuwick will
    // not choose.
    problems.push({
      line,
      column,
      message: `"${value}" is not a date in YYYY-MM-DD form. Formats like 4/11/25 mean different days in different countries and are refused rather than guessed.`,
    });
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    problems.push({ line, column, message: `"${value}" is not a real date.` });
    return null;
  }
  return value;
}

function requireMoney(value: string, column: string, line: number, problems: RowProblem[]): number | null {
  if (!value) {
    problems.push({ line, column, message: 'Required.' });
    return null;
  }
  return checkMoney(value, column, line, problems);
}

function optionalMoney(value: string, column: string, line: number, problems: RowProblem[]): number | null {
  if (!value) return null;
  return checkMoney(value, column, line, problems);
}

function checkMoney(value: string, column: string, line: number, problems: RowProblem[]): number | null {
  // Strip what a spreadsheet adds and a person types: currency, thousands
  // separators, stray spaces. Anything left that is not a number is refused.
  const cleaned = value.replace(/^RM\s*/i, '').replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    problems.push({ line, column, message: `"${value}" is not an amount.` });
    return null;
  }
  const amount = Number(cleaned);
  if (amount < 0) {
    problems.push({ line, column, message: 'An amount cannot be negative. A credit is a separate claim, not a negative one.' });
    return null;
  }
  return amount;
}
