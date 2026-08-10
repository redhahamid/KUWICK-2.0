import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import {
  CancelPrescriptionDto,
  CopyPrescriptionsDto,
  CreatePrescriptionDto,
  Prescription,
  UpdateSupplyModeDto,
  Visit,
} from '../types';

// G4.5d3c-3a1 (D-091) — every prescription mutation refreshes the rows AND,
// narrowly, the doctor-phase status: prescriptions are an input to the
// footer's blockers (D-088), so a supply mode set or a medication added must
// reach it without waiting for a remount. NOTHING ELSE is invalidated —
// clinical notes in particular are never refetched by a medication change,
// because that query feeds an editor that may be holding unsaved text (C1).
function useInvalidatePrescriptionWork(visitId?: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['prescriptions', visitId] });
    queryClient.invalidateQueries({ queryKey: ['doctor-phase-status', visitId] });
  };
}

export function usePrescriptions(visitId?: string) {
  return useQuery({
    queryKey: ['prescriptions', visitId],
    queryFn: () => apiClient.get<Prescription[]>(`/prescriptions?visitId=${visitId}`),
    enabled: Boolean(visitId),
  });
}

// Powers the "Copy Previous Prescription" date picker.
export function usePrescriptionCopySources(patientId?: string, excludeVisitId?: string) {
  return useQuery({
    queryKey: ['prescription-copy-sources', patientId, excludeVisitId],
    queryFn: () =>
      apiClient.get<Visit[]>(
        `/prescriptions/copy-sources?patientId=${patientId}${excludeVisitId ? `&excludeVisitId=${excludeVisitId}` : ''}`,
      ),
    enabled: Boolean(patientId),
  });
}

export function useCreatePrescription(visitId?: string) {
  const invalidate = useInvalidatePrescriptionWork(visitId);
  return useMutation({
    mutationFn: (dto: CreatePrescriptionDto) => apiClient.post<Prescription>('/prescriptions', dto),
    onSuccess: invalidate,
  });
}

/**
 * G4.5d3c-3c — the copy result carries the supply-mode outcome.
 *
 * The server decides what supply mode each copied line gets (carry over what
 * the previous visit recorded; default where it recorded nothing), and says
 * which happened. The rows alone cannot tell those apart, so the sentence
 * comes from the server rather than being reconstructed here.
 */
export interface CopyPrescriptionsResult {
  prescriptions: Prescription[];
  supplySummary: string;
}

export function useCopyPrescriptions(visitId?: string) {
  const invalidate = useInvalidatePrescriptionWork(visitId);
  return useMutation({
    mutationFn: (dto: CopyPrescriptionsDto) =>
      apiClient.post<CopyPrescriptionsResult>('/prescriptions/copy', dto),
    onSuccess: invalidate,
  });
}

function usePrescriptionAction(visitId: string | undefined, action: string) {
  const invalidate = useInvalidatePrescriptionWork(visitId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input?: CancelPrescriptionDto }) =>
      apiClient.patch<Prescription>(`/prescriptions/${id}/${action}`, input),
    onSuccess: invalidate,
  });
}

export const useDispensePrescription = (visitId?: string) => usePrescriptionAction(visitId, 'dispense');
export const useCancelPrescription = (visitId?: string) => usePrescriptionAction(visitId, 'cancel');

// D-091 — the supply intent. The server re-checks author, branch and status;
// this refreshes only what the change genuinely moved.
export function useSetSupplyMode(visitId?: string) {
  const invalidate = useInvalidatePrescriptionWork(visitId);
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateSupplyModeDto }) =>
      apiClient.patch<Prescription>(`/prescriptions/${id}/supply-mode`, dto),
    onSuccess: invalidate,
  });
}

/**
 * KW2-C2 — "reviewed ✓" on a carried-over medication.
 *
 * The acting user is taken from the SESSION by the server and is never sent
 * from here (owner decision 4): a clinical acknowledgement whose author the
 * client chose is not an acknowledgement. There is deliberately no body at
 * all, so there is nothing to forge.
 *
 * No un-review. Saying "I have re-read this" is a statement about something
 * that happened; a toggle that takes it back would let the record claim it
 * never did. If the medicine turns out to be wrong, the answer is to change or
 * cancel the prescription, both of which are already recorded acts.
 */
export function useMarkPrescriptionReviewed(visitId?: string) {
  const invalidate = useInvalidatePrescriptionWork(visitId);
  return useMutation({
    mutationFn: (id: string) => apiClient.patch<Prescription>(`/prescriptions/${id}/reviewed`),
    onSuccess: invalidate,
  });
}

export function useRemovePrescription(visitId?: string) {
  const invalidate = useInvalidatePrescriptionWork(visitId);
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/prescriptions/${id}`),
    onSuccess: invalidate,
  });
}
