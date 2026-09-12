/**
 * A SUM OF RINGGIT IN WORDS — the line under the net pay on a payslip.
 *
 *   997914 → "Ringgit Malaysia nine thousand nine hundred seventy-nine and sen fourteen only"
 *
 * The cheque-writing form: ringgit first, then sen, then "only" so nothing can
 * be appended. Whole ringgit with no sen say so ("… and sen nil only" reads
 * oddly; "… only" does not). Up to the hundreds of millions, which is more
 * than any payslip; beyond that the digits are printed rather than guessed.
 */
const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function belowThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`);
  if (rest >= 20) {
    parts.push(rest % 10 === 0 ? TENS[Math.floor(rest / 10)] : `${TENS[Math.floor(rest / 10)]}-${ONES[rest % 10]}`);
  } else if (rest > 0) {
    parts.push(ONES[rest]);
  }
  return parts.join(' ');
}

/** A whole number in words, "one thousand two hundred" — no "and", as on a cheque. */
export function numberInWords(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n >= 1_000_000_000) return String(n);
  if (n === 0) return 'zero';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions > 0) parts.push(`${belowThousand(millions)} million`);
  if (thousands > 0) parts.push(`${belowThousand(thousands)} thousand`);
  if (rest > 0) parts.push(belowThousand(rest));
  return parts.join(' ');
}

export function ringgitInWords(cents: number): string {
  const whole = Math.floor(Math.abs(cents) / 100);
  const sen = Math.abs(cents) % 100;
  const sign = cents < 0 ? 'minus ' : '';
  const ringgit = `Ringgit Malaysia ${sign}${numberInWords(whole)}`;
  return sen > 0 ? `${ringgit} and sen ${numberInWords(sen)} only` : `${ringgit} only`;
}
