import { MALAYSIAN_STATES } from './malaysianStates';

/**
 * TOWN AND STATE FROM A MALAYSIAN POSTCODE (new-clinic UAT, 15 October 2026).
 *
 * Source: the open `malaysia-postcodes` package (ISC licence), built from
 * github.com/AsyrafHussin/malaysia-postcodes, which lists each postcode with
 * its town and state. Loaded only when a postcode is typed, so the list is
 * not in the first page load. Its "Wp Kuala Lumpur" style names are mapped
 * to the state list every form here uses.
 */
export async function placeOfPostcode(postcode: string | null | undefined): Promise<{ town: string; state: string } | null> {
  const code = (postcode ?? '').trim();
  if (!/^\d{5}$/.test(code)) return null;
  const { findPostcode } = await import('malaysia-postcodes');
  const found = findPostcode(code) as { found: boolean; city?: string; state?: string };
  if (!found.found || !found.city || !found.state) return null;
  return { town: found.city, state: stateName(found.state) };
}

function stateName(name: string): string {
  const plain = name.toLowerCase().replace(/[^a-z]/g, '');
  return MALAYSIAN_STATES.find((state) => state.toLowerCase().replace(/[^a-z]/g, '') === plain) ?? name;
}
