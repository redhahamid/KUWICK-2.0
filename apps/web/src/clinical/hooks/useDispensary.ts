import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';

/**
 * G4.5d5b-3 — the dispensary's data access.
 *
 * ONE board query behind the whole workspace. A patient list where each row
 * fetched its own medications and each medication fetched its own stock would
 * be a request waterfall that gets worse exactly when the clinic is busiest,
 * which is the only time this screen is open. The server answers in a fixed
 * number of queries; the browser makes one request.
 *
 * Invalidation is narrow and deliberate. Dispensing refreshes the board, the
 * prescriptions for that visit and the queue — and touches NOTHING clinical.
 * There is no clinical-note key here and there must never be one: the
 * dispensary has no business remounting a doctor's editor.
 */

export type StockState = 'IN_STOCK' | 'LOW_STOCK' | 'INSUFFICIENT' | 'OUT_OF_STOCK' | 'UNIT_UNKNOWN';

export interface DispensaryMedication {
  prescriptionId: string;
  itemId: string;
  name: string;
  strength: string | null;
  doseAmount: string;
  doseUnit: string | null;
  frequency: string;
  durationDays: number;
  quantity: number;
  status: string;
  supplyMode: string | null;
  prescriberName: string | null;
  dispenserName: string | null;
  dispensedAt: string | null;
  stock: { onHand: number | null; state: StockState; prescriptionUnit: string | null };
  labelPrintCount: number;
  lastPrintedAt: string | null;
}

export interface DispensaryRow {
  visitId: string;
  queueTicketId: string;
  displayNumber: string | null;
  patientName: string;
  visitNumber: string;
  doctorName: string | null;
  checkInAt: string;
  queueStatus: string;
  counts: { total: number; dispensed: number; remaining: number };
  medications: DispensaryMedication[];
  unresolvedCount: number;
  hasStockWarning: boolean;
}

export interface DispensaryBoard {
  rows: DispensaryRow[];
  counts: { waitingPatients: number; medicationsRemaining: number; stockWarnings: number };
  permissions: {
    VIEW_DISPENSARY: boolean;
    PRINT_LABEL: boolean;
    DISPENSE_MEDICATION: boolean;
    RESOLVE_STOCK_ISSUE: boolean;
  };
}

export interface DispenseItemResult {
  prescriptionId: string;
  outcome: string;
  message: string;
  medicationName: string | null;
}

export interface DispenseResult {
  visitId: string;
  results: DispenseItemResult[];
  summary: { dispensed: number; alreadyDispensed: number; failed: number };
  routing: { dispensingComplete: boolean; queueStatus: string | null; message: string };
}

export interface LabelPayload {
  prescriptionId: string;
  clinic: { name: string; branch: string | null };
  patient: { name: string; identifier: string | null };
  medication: {
    name: string;
    strength: string | null;
    doseAmount: string;
    doseUnit: string | null;
    frequency: string;
    durationDays: number;
    quantity: number;
    indication: string | null;
    remark: string | null;

    // b1 PHASE A — the patient's half, from the prescription's own SNAPSHOT.
    // Null on anything written before the snapshot existed, and the layout
    // omits what is absent rather than printing an empty bracket.
    doseUnitBm: string | null;
    frequencyBm: string | null;
    consumptionInstructionBm: string | null;
    indicationBm: string | null;
    durationValue: number | null;
    durationUnit: string | null;
  };
  prescriber: string;
  processedBy: string;
  dispensedBy: string | null;
  visitReference: string;
  printedAt: string;
  copies: number;
  labelFormat: string;
  printSequence: number;
  isReprint: boolean;
}

export interface LabelHistoryEntry {
  id: string;
  printedByName: string;
  printedAt: string;
  copies: number;
  printSequence: number;
  isReprint: boolean;
}

export function useDispensaryBoard(clinicId?: string) {
  return useQuery({
    queryKey: ['dispensary-board', clinicId],
    queryFn: () => apiClient.get<DispensaryBoard>(`/dispensary/board?clinicId=${clinicId}`),
    enabled: Boolean(clinicId),
    // The counter is a live surface: a board that is a minute stale sends
    // somebody to fetch medicine that has already been handed over.
    staleTime: 0,
  });
}

export function useDispenseMedications(clinicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { visitId: string; prescriptionIds: string[]; acknowledgeStockWarning?: boolean }) =>
      apiClient.post<DispenseResult>('/dispensary/dispense', input),
    onSuccess: (_result, input) => {
      // Exactly what moved, and nothing else. No clinical-note key appears
      // here by design — see the note at the top of this file.
      void queryClient.invalidateQueries({ queryKey: ['dispensary-board', clinicId] });
      void queryClient.invalidateQueries({ queryKey: ['prescriptions', input.visitId] });
      void queryClient.invalidateQueries({ queryKey: ['queue-board'] });
    },
  });
}

/**
 * The label as it would print, WITHOUT recording a print.
 *
 * Separate from `usePrintLabel` on purpose: opening the preview must not
 * appear in the print history, or the history stops answering the question a
 * clinic asks it — "was this label actually printed, and by whom".
 */
export function useLabelPreview(prescriptionId?: string) {
  return useQuery({
    queryKey: ['label-preview', prescriptionId],
    // Deliberately NOT keyed by the copy count. The number of copies changes
    // how many times one label is rendered, not what is on it, and refetching
    // the prescription every time somebody nudges the count would blank the
    // preview they are in the middle of reading.
    queryFn: () => apiClient.get<LabelPayload>(`/dispensary/prescriptions/${prescriptionId}/label-preview`),
    enabled: Boolean(prescriptionId),
    staleTime: 0,
    // Never served from cache after a print: the sequence and the reprint
    // notice on the label both change once a print has been recorded.
    gcTime: 0,
  });
}

export function usePrintLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ prescriptionId, copies }: { prescriptionId: string; copies: number }) =>
      apiClient.post<LabelPayload>(`/dispensary/prescriptions/${prescriptionId}/label`, { copies }),
    onSuccess: (_payload, { prescriptionId }) => {
      void queryClient.invalidateQueries({ queryKey: ['label-history', prescriptionId] });
      // The preview's reprint notice and sequence are now out of date.
      void queryClient.invalidateQueries({ queryKey: ['label-preview', prescriptionId] });
      // The board carries the print count, so it refreshes too — but nothing
      // clinical does, because printing changed nothing clinical.
      void queryClient.invalidateQueries({ queryKey: ['dispensary-board'] });
    },
  });
}

export function useLabelHistory(prescriptionId?: string, enabled = false) {
  return useQuery({
    queryKey: ['label-history', prescriptionId],
    queryFn: () =>
      apiClient.get<LabelHistoryEntry[]>(`/dispensary/prescriptions/${prescriptionId}/label-history`),
    enabled: Boolean(prescriptionId) && enabled,
  });
}
