import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { CompleteDoctorPhaseDto, DoctorCompletionResult, DoctorPhaseStatus } from '../types';

/**
 * G4.5d3c-3a (D-089) — the Consultation Footer's two calls.
 *
 * The read is advisory and side-effect free (the server runs it in a
 * read-only transaction, D-088). The write is authoritative and re-evaluates
 * everything itself: whatever the preview said, the mutation decides.
 */

// `refetchOnWindowFocus` stays OFF for the same reason it is off for clinical
// notes (C1, D-052): a doctor alt-tabs constantly mid-consultation, and this
// query sits directly beneath an editor holding unsaved text. A refetch here
// cannot touch the draft — the footer owns no note state — but a footer that
// silently re-renders under the cursor is still the wrong behaviour.
export function useDoctorPhaseStatus(visitId?: string) {
  return useQuery({
    queryKey: ['doctor-phase-status', visitId],
    queryFn: () => apiClient.get<DoctorPhaseStatus>(`/visits/${visitId}/doctor-phase-status`),
    enabled: Boolean(visitId),
    refetchOnWindowFocus: false,
  });
}

/**
 * Completing the doctor phase.
 *
 * Invalidation is deliberately NARROW. The obvious move — invalidate
 * everything about the visit — would refetch clinical notes and put a server
 * seed back under an editor that may be holding unsaved text. C1's draft
 * guard would refuse the overwrite, but relying on a guard to undo a refetch
 * this component had no reason to trigger is not a design.
 *
 * What genuinely changes: this status, the queue ticket's stage, and the
 * visit row's doctor-completion columns. Nothing else moves.
 */
export function useCompleteDoctorPhase(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CompleteDoctorPhaseDto = {}) =>
      apiClient.patch<DoctorCompletionResult>(`/visits/${visitId}/complete-doctor-phase`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['doctor-phase-status', visitId] });
      queryClient.invalidateQueries({ queryKey: ['queue-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['visits', visitId] });
    },
  });
}
