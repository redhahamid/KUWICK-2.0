import { parseCsv } from './seed-import';

/**
 * THE ONBOARDING PATH — a template a clinic fills in, and an upload that
 * refuses badly rather than importing half of it.
 *
 * The audit's number is what this is for: 149 of 242 medicines with no
 * divisor, each needing a person to state a fact the spreadsheet never
 * carried. Doing that one medicine at a time through the Edit Inventory form
 * is 149 form opens. Doing it in a spreadsheet is an afternoon.
 *
 * THREE DECISIONS ABOUT THE SHAPE OF THE TEMPLATE, all of them about not
 * producing bad data:
 *
 * 1. **`DISPENSED_WHOLE` is a value the quantity column accepts.** D1 says a
 *    bare 1 is never enough, and a spreadsheet is exactly where somebody
 *    would fill 1 down a column of 128 rows. Writing the word is a statement;
 *    writing 1 is a number, and the import treats them differently.
 * 2. **ONE consumption-method column, written to BOTH homes.** The form has a
 *    free-text Consumption Method and a 1F catalogue reference, and two
 *    columns meaning the same thing in an onboarding spreadsheet get filled
 *    inconsistently. One input writes both, so they cannot diverge. Same for
 *    dose unit, frequency and duration, whose legacy free-text columns are
 *    still read as a fallback by `defaultsFromItem`.
 * 3. **1F's `defaultQuantity` is NOT in the template.** `seed:standard-rx`
 *    sets it well, and a second column also meaning "how many to hand over"
 *    beside Default Dispense Quantity is a trap rather than a feature.
 *
 * A BLANK CELL MEANS "I did not fill this in", never "delete what is there".
 * In a 200-row template most cells are blank, and reading blank as a clear
 * would make a partially-filled upload a bulk wipe.
 */

export interface CsvColumn {
  header: string;
  /** What goes in the example row, so the format is shown rather than described. */
  example: string;
  required?: boolean;
}

export const INVENTORY_CSV_COLUMNS: CsvColumn[] = [
  { header: 'Code', example: 'MED-001' },
  { header: 'Name', example: 'Paracetamol 500mg', required: true },
  { header: 'Category', example: 'Medication' },
  { header: 'Stock Unit', example: 'TABLET PER STRIP' },
  { header: 'Quantity per Stock Unit', example: '10' },
  { header: 'Conc. Vol (mL)', example: '' },
  { header: 'Strength (mg)', example: '500' },
  { header: 'Consumption Method', example: 'ORAL / MELALUI MULUT' },
  { header: 'Default Dispense Quantity', example: '10' },
  { header: 'Dose Amount', example: '1' },
  { header: 'Dose Unit', example: 'Tablet' },
  { header: 'Frequency', example: 'TDS' },
  { header: 'Duration Value', example: '5' },
  { header: 'Duration Unit', example: 'DAY' },
  { header: 'Indication', example: 'Fever' },
  { header: 'Prescription Reference', example: '' },
  { header: 'Remark', example: '' },
  { header: 'Cost (RM)', example: '0.08' },
  { header: 'Price to Patient (RM)', example: '0.20', required: true },
  { header: 'Track Batch & Expiry', example: 'YES' },
  { header: 'Active', example: 'YES' },
];

/** The literal a clinic writes instead of a number to make the D1 statement. */
export const DISPENSED_WHOLE_TOKEN = 'DISPENSED_WHOLE';

/**
 * The template, with ONE example row.
 *
 * The example is a real medicine from the clinic's own catalogue rather than
 * "Item 1": a clinic reading it learns the format of every column at once —
 * that Frequency wants "TDS" and not "three times a day", that YES/NO is how
 * a flag is written, that a blank is allowed.
 *
 * A second row shows the D1 case, because it is the one nobody would guess.
 */
export function inventoryCsvTemplate(): string {
  const header = INVENTORY_CSV_COLUMNS.map((column) => column.header);
  const example = INVENTORY_CSV_COLUMNS.map((column) => column.example);
  const whole = INVENTORY_CSV_COLUMNS.map((column) => {
    if (column.header === 'Name') return 'Cough Syrup 120ml';
    if (column.header === 'Code') return 'MED-002';
    if (column.header === 'Category') return 'Medication';
    if (column.header === 'Stock Unit') return 'BOTTLE';
    // The point of the second row: the bottle goes over the counter whole, and
    // saying so is different from writing 1.
    if (column.header === 'Quantity per Stock Unit') return DISPENSED_WHOLE_TOKEN;
    if (column.header === 'Price to Patient (RM)') return '12.00';
    if (column.header === 'Track Batch & Expiry') return 'YES';
    if (column.header === 'Active') return 'YES';
    return '';
  });
  return [header, example, whole].map(toCsvLine).join('\n') + '\n';
}

function toCsvLine(cells: string[]): string {
  return cells.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(',');
}

/** One thing wrong with one row, named where the clinic can find it. */
export interface RowProblem {
  /** The line number IN THE SPREADSHEET, header counted. What the clinic sees. */
  line: number;
  column: string;
  message: string;
}

/** A row's values, still as text where they name something to be looked up. */
export interface ParsedInventoryRow {
  line: number;
  code?: string;
  name: string;
  category?: string;
  stockUnitName?: string;
  /** Null where the cell was blank; the row is imported and NEEDS ATTENTION. */
  quantityPerStockUnit: number | null;
  dispensedWhole: boolean;
  concVolMl?: number;
  strengthMg?: number;
  consumptionMethodName?: string;
  defaultDispenseQuantity?: number;
  doseAmount?: number;
  doseUnitName?: string;
  frequencyCode?: string;
  durationValue?: number;
  durationUnit?: 'DAY' | 'WEEK' | 'MONTH';
  indication?: string;
  prescriptionReference?: string;
  remark?: string;
  cost?: number;
  sellPrice: number;
  tracksBatchExpiry?: boolean;
  active?: boolean;
}

export interface ParsedInventoryCsv {
  rows: ParsedInventoryRow[];
  problems: RowProblem[];
  /** Rows that carry no divisor and no declaration — the worklist this adds to. */
  needsAttention: number;
}

const DURATION_UNITS = ['DAY', 'WEEK', 'MONTH'];

/**
 * Parse and validate the WHOLE file before anything is written.
 *
 * Nothing here touches the database — the names it collects are resolved by
 * the service, which is also where a row is matched to an existing item. The
 * split is what lets the format be tested exhaustively without a Postgres.
 */
export function parseInventoryCsv(text: string): ParsedInventoryCsv {
  const records = parseCsv(text);
  const problems: RowProblem[] = [];
  const rows: ParsedInventoryRow[] = [];
  const seenNames = new Map<string, number>();

  records.forEach((record, index) => {
    // +2: one for the header, one because a spreadsheet's first row is 1.
    const line = index + 2;
    const before = problems.length;
    const cell = (header: string) => (record[header] ?? '').trim();

    const name = cell('Name');
    if (!name) problems.push({ line, column: 'Name', message: 'A name is required.' });

    // A file that names the same medicine twice would import one and then
    // overwrite it with the other, and the clinic would never know which won.
    const key = name.toLowerCase();
    if (name && seenNames.has(key)) {
      problems.push({
        line,
        column: 'Name',
        message: `"${name}" is also on line ${seenNames.get(key)}. Each medicine should appear once.`,
      });
    } else if (name) {
      seenNames.set(key, line);
    }

    const sellPrice = number(cell('Price to Patient (RM)'));
    if (cell('Price to Patient (RM)') === '') {
      problems.push({ line, column: 'Price to Patient (RM)', message: 'A price to the patient is required.' });
    } else if (sellPrice === null || sellPrice < 0) {
      problems.push({
        line,
        column: 'Price to Patient (RM)',
        message: `"${cell('Price to Patient (RM)')}" is not a price. Write a number like 4.50.`,
      });
    }

    const cost = optionalNumber(cell('Cost (RM)'), 'Cost (RM)', line, problems);
    const concVolMl = optionalNumber(cell('Conc. Vol (mL)'), 'Conc. Vol (mL)', line, problems);
    const strengthMg = optionalNumber(cell('Strength (mg)'), 'Strength (mg)', line, problems);
    const doseAmount = optionalNumber(cell('Dose Amount'), 'Dose Amount', line, problems);
    const defaultDispenseQuantity = optionalInteger(
      cell('Default Dispense Quantity'),
      'Default Dispense Quantity',
      line,
      problems,
    );
    const durationValue = optionalInteger(cell('Duration Value'), 'Duration Value', line, problems);

    // D1 — the column that takes a word as well as a number.
    const rawQuantity = cell('Quantity per Stock Unit');
    let quantityPerStockUnit: number | null = null;
    let dispensedWhole = false;
    if (rawQuantity.toUpperCase().replace(/[\s-]/g, '_') === DISPENSED_WHOLE_TOKEN) {
      dispensedWhole = true;
      quantityPerStockUnit = 1;
    } else if (rawQuantity !== '') {
      const parsed = number(rawQuantity);
      if (parsed === null || !Number.isInteger(parsed) || parsed < 1) {
        problems.push({
          line,
          column: 'Quantity per Stock Unit',
          message: `"${rawQuantity}" is not a count. Write how many are in one stock unit, or ${DISPENSED_WHOLE_TOKEN} if the item is handed over whole.`,
        });
      } else {
        quantityPerStockUnit = parsed;
      }
    }

    const durationUnitRaw = cell('Duration Unit').toUpperCase();
    if (durationUnitRaw && !DURATION_UNITS.includes(durationUnitRaw)) {
      problems.push({
        line,
        column: 'Duration Unit',
        message: `"${cell('Duration Unit')}" is not a duration. Use ${DURATION_UNITS.join(', ')}.`,
      });
    }

    const tracksBatchExpiry = optionalFlag(cell('Track Batch & Expiry'), 'Track Batch & Expiry', line, problems);
    const active = optionalFlag(cell('Active'), 'Active', line, problems);

    // ALL-OR-NOTHING PER ROW: a row with anything wrong is not half-imported.
    if (problems.length > before) return;

    rows.push({
      line,
      code: blankToUndefined(cell('Code')),
      name,
      category: blankToUndefined(cell('Category')),
      stockUnitName: blankToUndefined(cell('Stock Unit')),
      quantityPerStockUnit,
      dispensedWhole,
      concVolMl: concVolMl ?? undefined,
      strengthMg: strengthMg ?? undefined,
      consumptionMethodName: blankToUndefined(cell('Consumption Method')),
      defaultDispenseQuantity: defaultDispenseQuantity ?? undefined,
      doseAmount: doseAmount ?? undefined,
      doseUnitName: blankToUndefined(cell('Dose Unit')),
      frequencyCode: blankToUndefined(cell('Frequency')),
      durationValue: durationValue ?? undefined,
      durationUnit: (durationUnitRaw || undefined) as ParsedInventoryRow['durationUnit'],
      indication: blankToUndefined(cell('Indication')),
      prescriptionReference: blankToUndefined(cell('Prescription Reference')),
      remark: blankToUndefined(cell('Remark')),
      cost: cost ?? undefined,
      sellPrice: sellPrice as number,
      tracksBatchExpiry,
      active,
    });
  });

  return {
    rows,
    problems,
    // Counted and REPORTED rather than refused. A row with no divisor is
    // legitimate — the clinic may not know yet — and refusing it would keep
    // the medicine out of the catalogue entirely to protect a number that is
    // already missing on 149 rows.
    needsAttention: rows.filter((row) => row.quantityPerStockUnit === null).length,
  };
}

function blankToUndefined(value: string): string | undefined {
  return value === '' ? undefined : value;
}

function number(value: string): number | null {
  if (value === '') return null;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalNumber(value: string, column: string, line: number, problems: RowProblem[]): number | null {
  if (value === '') return null;
  const parsed = number(value);
  if (parsed === null || parsed < 0) {
    problems.push({ line, column, message: `"${value}" is not a number.` });
    return null;
  }
  return parsed;
}

function optionalInteger(value: string, column: string, line: number, problems: RowProblem[]): number | null {
  const parsed = optionalNumber(value, column, line, problems);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed)) {
    problems.push({ line, column, message: `"${value}" must be a whole number.` });
    return null;
  }
  return parsed;
}

/**
 * YES / NO, and the spellings a spreadsheet actually produces.
 *
 * Excel writes TRUE/FALSE, people write Y/N, and a clinic writing "1" means
 * yes. Anything else is REFUSED rather than guessed: reading an unrecognised
 * word as "no" would quietly switch off expiry tracking on a medicine.
 */
function optionalFlag(value: string, column: string, line: number, problems: RowProblem[]): boolean | undefined {
  if (value === '') return undefined;
  const upper = value.toUpperCase();
  if (['YES', 'Y', 'TRUE', '1'].includes(upper)) return true;
  if (['NO', 'N', 'FALSE', '0'].includes(upper)) return false;
  problems.push({ line, column, message: `"${value}" is not yes or no.` });
  return undefined;
}
