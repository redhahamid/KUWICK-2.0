import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { VisitHistoryDetail, VisitHistoryPage } from '../types';

/**
 * G4 (D-067) — the ONLY data access the read-only history uses.
 *
 * Two deliberate properties:
 *
 *  - There is no mutation hook in this file, and the history components import
 *    nothing else that has one. Reviewing a previous visit cannot write.
 *
 *  - The cache keys start with 'visit-history' and are keyed by visit id, so
 *    historical data never lands in — or invalidates — the current visit's
 *    caches ('visits', 'clinical-notes', 'diagnoses', …). A doctor's open
 *    consultation cannot be refreshed out from under them by opening history.
 */

export interface VisitHistoryFilters {
  search?: string;
  from?: string;
  to?: string;
  staffId?: string;
}

const PAGE_SIZE = 10;

export function useVisitHistory(patientId: string | undefined, filters: VisitHistoryFilters = {}) {
  return useInfiniteQuery({
    queryKey: ['visit-history', patientId, filters.search ?? '', filters.from ?? '', filters.to ?? '', filters.staffId ?? ''],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (pageParam) params.set('cursor', pageParam);
      if (filters.search) params.set('search', filters.search);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      if (filters.staffId) params.set('staffId', filters.staffId);
      return apiClient.get<VisitHistoryPage>(`/patients/${patientId}/history?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(patientId),
    // A finished visit does not change while it is being read. Caching it for
    // the session avoids refetching the same record every time a card is
    // collapsed and reopened.
    staleTime: 5 * 60 * 1000,
  });
}

export function useVisitHistoryDetail(patientId: string | undefined, visitId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['visit-history', 'detail', patientId, visitId],
    queryFn: () => apiClient.get<VisitHistoryDetail>(`/patients/${patientId}/history/${visitId}`),
    enabled: Boolean(patientId && visitId && enabled),
    staleTime: 5 * 60 * 1000,
  });
}
