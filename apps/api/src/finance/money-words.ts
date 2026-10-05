/**
 * A SUM OF RINGGIT IN WORDS — the line under the net pay on a payslip.
 *
 *   1380631 → "Ringgit Malaysia Thirteen Thousand Eight Hundred Six and Thirty-One Sen Only"
 *
 * The cheque-writing form the clinic asked for (UAT, 5 October 2026): every
 * word capitalised, ringgit first, then the sen as "… and Thirty-One Sen",
 * then "Only" so nothing can be appended. Whole ringgit with no sen end at
 * "Only". No "and" inside the ringgit ("Eight Hundred Six"), as on a cheque.
 * Up to the hundreds of millions, which is more than any payslip; beyond that
 * the digits are printed rather than guessed.
 */
const ONES = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest >= 20) {
    parts.push(rest % 10 === 0 ? TENS[Math.floor(rest / 10)] : `${TENS[Math.floor(rest / 10)]}-${ONES[rest % 10]}`);
  } else if (rest > 0) {
    parts.push(ONES[rest]);
  }
  return parts.join(' ');
}

/** A whole number in words, "One Thousand Two Hundred" — no "and", as on a cheque. */
export function numberInWords(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n >= 1_000_000_000) return String(n);
  if (n === 0) return 'Zero';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions > 0) parts.push(`${belowThousand(millions)} Million`);
  if (thousands > 0) parts.push(`${belowThousand(thousands)} Thousand`);
  if (rest > 0) parts.push(belowThousand(rest));
  return parts.join(' ');
}

export function ringgitInWords(cents: number): string {
  const whole = Math.floor(Math.abs(cents) / 100);
  const sen = Math.abs(cents) % 100;
  const sign = cents < 0 ? 'Minus ' : '';
  const ringgit = `Ringgit Malaysia ${sign}${numberInWords(whole)}`;
  return sen > 0 ? `${ringgit} and ${numberInWords(sen)} Sen Only` : `${ringgit} Only`;
}
