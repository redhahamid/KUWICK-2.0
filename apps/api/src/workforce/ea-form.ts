/**
 * THE EA FORM (BORANG EA, C.P.8A) — which box each payroll item goes in, and
 * the year's figures per box (overnight brief, 15 October 2026).
 *
 * Pure arithmetic over figures the approved months already froze: nothing
 * here recalculates pay. Each payroll item names its own box (`eaField`); an
 * item with none uses the default below, which the clinic can change on the
 * item. The defaults are a starting point to check with a tax adviser.
 */

export const EA_BOXES = ['B1a', 'B1b', 'B1c', 'B1d', 'B1e', 'B1f', 'B2', 'B3', 'B4', 'B5', 'B6', 'F', 'NONE'] as const;
export type EaBox = (typeof EA_BOXES)[number];

/** What each box holds, as the form words it. */
export const EA_BOX_LABEL: Record<EaBox, string> = {
  B1a: 'B1(a) Gross salary, wages or leave pay (including overtime)',
  B1b: 'B1(b) Fees (including director fees), commission or bonus',
  B1c: 'B1(c) Tips, perquisites, awards or other allowances',
  B1d: 'B1(d) Income tax borne by the employer',
  B1e: 'B1(e) Employee share option benefit',
  B1f: 'B1(f) Gratuity',
  B2: 'B2 Arrears for earlier years paid this year',
  B3: 'B3 Benefits in kind',
  B4: 'B4 Value of living accommodation',
  B5: 'B5 Refund from an unapproved provident or pension fund',
  B6: 'B6 Compensation for loss of employment',
  F: 'F Tax-exempt allowances, perquisites, gifts or benefits',
  NONE: 'Not on the EA form',
};

export interface EaItem {
  code: string;
  type: string;
  category: string;
  includeIn: string;
  pcbLiable: boolean;
  additionalRemuneration: boolean;
  eaField: string | null;
}

const BONUS_LIKE = /BONUS|COMMISSION|DIRECTOR_FEE|INCENTIVE/;

/** Kuwick's suggestion for an item that names no box. */
export function defaultEaBox(item: Omit<EaItem, 'eaField'>): EaBox {
  // A wage reduction (unpaid leave) makes the salary smaller; anything else taken off is not pay.
  if (item.type === 'DEDUCTION') return item.includeIn === 'NET_ONLY' ? 'NONE' : 'B1a';
  if (!item.pcbLiable) return 'F';
  if (item.category === 'BENEFIT_IN_KIND') return 'B3';
  if (item.category === 'ALLOWANCE' || item.category === 'PERQUISITE') return 'B1c';
  if (BONUS_LIKE.test(item.code) || item.additionalRemuneration) return 'B1b';
  return 'B1a';
}

/** The box in force: the item's own, else the default. */
export function eaBoxOf(item: EaItem): EaBox {
  return (EA_BOXES as readonly string[]).includes(item.eaField ?? '') ? (item.eaField as EaBox) : defaultEaBox(item);
}

/** One approved month for one person: its item lines, or only its total when the lines were not kept. */
export interface EaMonth {
  month: number;
  grossCents: number;
  /** Null for an imported opening balance or a month approved before item lines were kept. */
  lines: { code: string; kind: string; amountCents: number }[] | null;
}

export interface EaFigures {
  boxes: Record<EaBox, number>;
  /** Months whose total went into B1(a) because no item lines exist for them. */
  totalsOnlyMonths: number[];
  /** Item codes paid this year with no item record to say where they go (put in B1(a)). */
  unknownCodes: string[];
  /** B and F together, against the year-to-date gross: they should agree. */
  differenceCents: number;
}

/** The year's pay, box by box. */
export function eaFigures(months: EaMonth[], items: Map<string, EaItem>): EaFigures {
  const boxes = Object.fromEntries(EA_BOXES.map((box) => [box, 0])) as Record<EaBox, number>;
  const totalsOnlyMonths: number[] = [];
  const unknown = new Set<string>();
  let grossCents = 0;
  for (const month of months) {
    grossCents += month.grossCents;
    if (!month.lines) {
      boxes.B1a += month.grossCents;
      totalsOnlyMonths.push(month.month);
      continue;
    }
    for (const line of month.lines) {
      // Only pay counts here; tax, zakat and other deductions come from the year-to-date record.
      if (line.kind !== 'EARNING' && line.kind !== 'WAGE_REDUCTION') continue;
      const item = items.get(line.code);
      if (!item) unknown.add(line.code);
      const box = item ? eaBoxOf(item) : 'B1a';
      boxes[box] += line.kind === 'WAGE_REDUCTION' ? -line.amountCents : line.amountCents;
    }
  }
  const counted = EA_BOXES.filter((box) => box !== 'NONE').reduce((sum, box) => sum + boxes[box], 0);
  return { boxes, totalsOnlyMonths, unknownCodes: [...unknown].sort(), differenceCents: counted + boxes.NONE - grossCents };
}
