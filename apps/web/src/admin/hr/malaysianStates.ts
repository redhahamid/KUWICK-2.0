/**
 * The states and federal territories, as an address form offers them. The
 * names match the API's holiday list (apps/api/src/hr/holiday-presets.ts).
 */
export const MALAYSIAN_STATES = [
  'Johor',
  'Kedah',
  'Kelantan',
  'Melaka',
  'Negeri Sembilan',
  'Pahang',
  'Perak',
  'Perlis',
  'Pulau Pinang',
  'Sabah',
  'Sarawak',
  'Selangor',
  'Terengganu',
  'W.P. Kuala Lumpur',
  'W.P. Labuan',
  'W.P. Putrajaya',
] as const;

/** The rest of an address on one line: "43650 Bandar Baru Bangi, Selangor". */
export function addressTail(parts: { postcode?: string | null; city?: string | null; state?: string | null }): string | null {
  const town = [parts.postcode, parts.city].filter(Boolean).join(' ');
  const tail = [town, parts.state].filter(Boolean).join(', ');
  return tail || null;
}

/** Banks a Malaysian salary is commonly paid into, by the name printed on a payslip. */
export const MALAYSIAN_BANKS = [
  'Affin Bank',
  'AEON Bank',
  'Agrobank',
  'Al Rajhi Bank',
  'Alliance Bank',
  'AmBank',
  'Bank Islam',
  'Bank Muamalat',
  'Bank Rakyat',
  'Bank Simpanan Nasional (BSN)',
  'Boost Bank',
  'CIMB Bank',
  'Citibank',
  'GXBank',
  'Hong Leong Bank',
  'HSBC Bank',
  'Kuwait Finance House',
  'Maybank',
  'MBSB Bank',
  'OCBC Bank',
  'Public Bank',
  'RHB Bank',
  'Standard Chartered',
  'UOB Bank',
] as const;

export const stateOptions = MALAYSIAN_STATES.map((value) => ({ value, label: value }));
export const bankOptions = MALAYSIAN_BANKS.map((value) => ({ value, label: value }));

/** A state typed before the list existed ("selangor", "KL"), matched to the list where it plainly is one. */
export function stateOf(text: string | null | undefined): string | null {
  const plain = (text ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!plain) return null;
  const alias: Record<string, string> = { kl: 'W.P. Kuala Lumpur', kualalumpur: 'W.P. Kuala Lumpur', penang: 'Pulau Pinang', putrajaya: 'W.P. Putrajaya', labuan: 'W.P. Labuan', malacca: 'Melaka' };
  return alias[plain] ?? MALAYSIAN_STATES.find((state) => state.toLowerCase().replace(/[^a-z]/g, '').endsWith(plain)) ?? null;
}
