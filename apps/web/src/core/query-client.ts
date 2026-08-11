import { QueryClient } from '@tanstack/react-query';

/**
 * G4.5d5b-1 — query defaults, chosen per KIND of data rather than globally.
 *
 * The client was constructed with no options at all, so every query used
 * React Query's defaults: `staleTime: 0` and a refetch on every window focus.
 * For a clinic that means the item catalogue is re-downloaded each time a
 * doctor alt-tabs back from a phone call, and the same catalogue is fetched
 * again by every rail that needs it.
 *
 * The correction is deliberately NOT an aggressive global staleTime. Clinical
 * state and catalogue data have opposite requirements: a queue board or a
 * dispensing status that is thirty seconds stale is actively dangerous, while
 * an item catalogue that is five minutes stale is simply an item catalogue.
 * So the DEFAULT stays fresh-on-focus, and only stable catalogues opt out
 * through `CATALOGUE_QUERY_OPTIONS`.
 *
 * Retries are limited to one. A clinical write that failed should surface its
 * error to the user quickly; three silent retries just delay the message.
 */
export const CATALOGUE_STALE_MS = 5 * 60 * 1000;

/**
 * Spread into a query for STABLE reference data — items, services, diagnosis
 * codes, panel lists. Never into anything that describes a patient right now.
 */
export const CATALOGUE_QUERY_OPTIONS = {
  staleTime: CATALOGUE_STALE_MS,
  gcTime: 10 * 60 * 1000,
  refetchOnWindowFocus: false,
} as const;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Clinical data stays fresh by default. Anything that wants to be
        // cached says so explicitly, at its own call site, where the decision
        // can be reviewed against what the data actually is.
        staleTime: 0,
        refetchOnWindowFocus: true,
        retry: 1,
      },
      mutations: {
        // A clinical write is never retried automatically. The dispensing and
        // completion endpoints are idempotent by design, but a silent retry
        // still hides a failure the user needs to see.
        retry: 0,
      },
    },
  });
}
