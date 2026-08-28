/**
 * MONEY, AND WHY IT IS NOT A `number`.
 *
 * Every amount in this schema is `Decimal(10,2)` or `Decimal(12,2)`. Prisma
 * hands those back as `Prisma.Decimal`, and the moment one is coerced with
 * `Number()` and added to another, the result is a float: 0.1 + 0.2 is not
 * 0.3, and a day-end that reconciles to RM0.00 in the database reconciles to
 * RM-0.000000001 in JavaScript.
 *
 * The whole of finance therefore works in CENTS — integers — and converts back
 * exactly once, at the edge. There is no rounding policy to get wrong because
 * there is no rounding: two decimal places in, two decimal places out.
 */

export type MoneyLike = number | string | { toString(): string } | null | undefined;

/**
 * Cents from anything the database or a DTO can produce.
 *
 * `Prisma.Decimal` stringifies exactly (it is arbitrary-precision internally),
 * which is why this parses the STRING rather than reading `.toNumber()`.
 */
export function toCents(value: MoneyLike): number {
  if (value === null || value === undefined) return 0;
  const text = typeof value === 'string' ? value : typeof value === 'number' ? value.toFixed(10) : value.toString();
  const trimmed = text.trim();
  if (trimmed === '') return 0;

  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) {
    throw new TypeError(`Not a money value: ${text}`);
  }
  const sign = match[1] === '-' ? -1 : 1;
  const whole = match[2] === '' ? 0 : Number(match[2]);
  const fractionText = (match[3] ?? '').padEnd(3, '0');
  const cents = Number(fractionText.slice(0, 2));
  // Third decimal decides the rounding of the second — half away from zero,
  // which is what a cash drawer does and what Malaysian invoicing expects.
  const roundUp = Number(fractionText[2] ?? '0') >= 5;
  return sign * (whole * 100 + cents + (roundUp ? 1 : 0));
}

/** Cents back to the two-decimal number the API and the UI speak. */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Formats cents for display: `1234` → `"12.34"`. Never locale-dependent. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function sumCents(values: MoneyLike[]): number {
  return values.reduce<number>((total, value) => total + toCents(value), 0);
}

/**
 * A percentage OF a cents amount, rounded half-away-from-zero to the cent.
 *
 * Used for tax and for percentage discounts. Integer-only: `basisCents *
 * rateMilliPercent` stays exact for any amount a clinic will ever invoice.
 */
export function percentOfCents(basisCents: number, ratePercent: MoneyLike): number {
  // Rates are Decimal(6,3) — THREE decimal places — so they are parsed at
  // three, not through `toCents`, which would round 6.375% to 6.38% and quietly
  // change the tax on every line.
  const numerator = basisCents * toThousandths(ratePercent);
  const denominator = 100 * 1000;
  const sign = numerator < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(numerator) / denominator);
}

/**
 * A rate parsed at three decimal places, in thousandths: `6.375` → `6375`.
 * Separate from `toCents` because a RATE and an AMOUNT have different scales,
 * and sharing one parser is how a rate silently loses its third digit.
 */
export function toThousandths(value: MoneyLike): number {
  if (value === null || value === undefined) return 0;
  const text = (typeof value === 'number' ? value.toFixed(6) : String(value)).trim();
  if (text === '') return 0;
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) {
    throw new TypeError(`Not a rate: ${text}`);
  }
  const sign = match[1] === '-' ? -1 : 1;
  const whole = match[2] === '' ? 0 : Number(match[2]);
  const fraction = (match[3] ?? '').padEnd(4, '0');
  const thousandths = Number(fraction.slice(0, 3));
  const roundUp = Number(fraction[3] ?? '0') >= 5;
  return sign * (whole * 1000 + thousandths + (roundUp ? 1 : 0));
}

/** Never below zero — for balances, where a negative remainder means "settled". */
export function clampAtZero(cents: number): number {
  return cents < 0 ? 0 : cents;
}
