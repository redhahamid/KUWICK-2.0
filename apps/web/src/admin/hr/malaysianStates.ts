/** The states and federal territories, as an address form offers them. */
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
