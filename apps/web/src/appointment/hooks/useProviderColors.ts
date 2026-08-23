import { useCallback, useMemo } from 'react';
import { ProviderColor } from '@kuwick/shared';
import { useStaff } from '../../hr/hooks/useStaff';
import { NEUTRAL_PROVIDER_COLOR, providerColorFor } from '../calendar/doctor-color';

/**
 * THE ONE PLACE A SURFACE ASKS "WHAT COLOUR IS THIS DOCTOR?".
 *
 * The answer is the provider's own stored `Staff.calendarColor` — the column
 * has always existed and the API has always sent it on `/staff`; before this
 * pass the web app fetched it and then threw it away in favour of a hash,
 * which is how curated clinic colours ended up overridden by whatever a uuid
 * hashed to.
 *
 * Backed by the same `['staff']` query every appointment screen already
 * holds, so calling this costs no extra request: react-query hands back the
 * cached list. A staff id the list does not contain (a locum removed from the
 * roster, a record still loading) resolves through the deterministic
 * fallback rather than flashing a different colour on every render.
 */
export type ProviderColorResolver = (staffId: string | null | undefined) => ProviderColor;

export function useProviderColors(): ProviderColorResolver {
  const { data: staff } = useStaff();

  const stored = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const member of staff ?? []) map.set(member.id, member.calendarColor);
    return map;
  }, [staff]);

  return useCallback(
    (staffId: string | null | undefined) => {
      if (!staffId) return NEUTRAL_PROVIDER_COLOR;
      return providerColorFor(stored.get(staffId), staffId);
    },
    [stored],
  );
}
