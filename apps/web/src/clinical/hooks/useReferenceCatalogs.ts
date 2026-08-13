import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';

/**
 * b1 PHASE 1G — the five prescription reference catalogues, in the browser.
 *
 * One hook family for all five, mirroring `/reference-catalogs/:catalog` on the
 * API side and for the same reason: the five differ only in their columns, and
 * five copies of "SYSTEM rows are read-only" is five places for it to drift.
 *
 * `includeRetired` is part of the QUERY KEY, not just the URL. Settings must
 * show a retired row in order to offer bringing it back, and every clinical
 * surface must not — sharing one cache entry between them would put a withdrawn
 * frequency back on a prescribing form.
 */

export type CatalogOrigin = 'SYSTEM' | 'CUSTOM';

/** What every catalogue row carries, whichever list it is in. */
export interface ReferenceCatalogRow {
  id: string;
  tenantId: string;
  origin: CatalogOrigin;
  active: boolean;
  sortOrder: number;
}

/** 1A — how often a dose is taken. */
export interface PrescriptionFrequencyRow extends ReferenceCatalogRow {
  code: string;
  doctorDisplay: string;
  patientLabelBm: string;
  /** NULL is a real answer: PRN and STAT cannot be counted per day. */
  timesPerDay: number | null;
}

/** 1B — the unit a dose is measured in. */
export interface DosageUnitRow extends ReferenceCatalogRow {
  systemNameEn: string;
  patientLabelBm: string;
  useCase: string | null;
}

/** 1C — how the medicine is taken, and the instruction that prints for it. */
export interface ConsumptionMethodRow extends ReferenceCatalogRow {
  methodBilingual: string;
  patientInstructionBm: string;
}

/** 1D — what the medicine is for. */
export interface IndicationRow extends ReferenceCatalogRow {
  labelEn: string;
  labelBm: string;
}

/** 1E — how stock is counted on the shelf. Platform-owned. */
export interface StockUnitRow extends ReferenceCatalogRow {
  name: string;
}

export interface ReferenceCatalogRows {
  frequencies: PrescriptionFrequencyRow;
  'dosage-units': DosageUnitRow;
  'consumption-methods': ConsumptionMethodRow;
  indications: IndicationRow;
  'stock-units': StockUnitRow;
}

export type ReferenceCatalogName = keyof ReferenceCatalogRows;

export const REFERENCE_CATALOG_NAMES: ReferenceCatalogName[] = [
  'frequencies',
  'dosage-units',
  'consumption-methods',
  'indications',
  'stock-units',
];

const key = (catalog: ReferenceCatalogName, includeRetired: boolean) =>
  ['reference-catalogs', catalog, includeRetired ? 'with-retired' : 'active'] as const;

export function useReferenceCatalog<C extends ReferenceCatalogName>(
  catalog: C,
  includeRetired = false,
) {
  return useQuery({
    queryKey: key(catalog, includeRetired),
    queryFn: () =>
      apiClient.get<ReferenceCatalogRows[C][]>(
        `/reference-catalogs/${catalog}${includeRetired ? '?includeRetired=true' : ''}`,
      ),
  });
}

/**
 * Invalidate BOTH views of a catalogue after any write.
 *
 * A row retired in Settings has to disappear from the prescribing form's list
 * as well, and those are two cache entries. Invalidating the prefix covers
 * both without either surface having to know the other exists.
 */
function useCatalogInvalidation(catalog: ReferenceCatalogName) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['reference-catalogs', catalog] });
}

export function useCreateCatalogEntry<C extends ReferenceCatalogName>(catalog: C) {
  const invalidate = useCatalogInvalidation(catalog);
  return useMutation({
    mutationFn: (body: Partial<ReferenceCatalogRows[C]>) =>
      apiClient.post<ReferenceCatalogRows[C]>(`/reference-catalogs/${catalog}`, body),
    onSuccess: invalidate,
  });
}

export function useUpdateCatalogEntry<C extends ReferenceCatalogName>(catalog: C) {
  const invalidate = useCatalogInvalidation(catalog);
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ReferenceCatalogRows[C]> }) =>
      apiClient.patch<ReferenceCatalogRows[C]>(`/reference-catalogs/${catalog}/${id}`, body),
    onSuccess: invalidate,
  });
}

/**
 * Retire, or bring back. There is no delete — these rows are referenced by
 * prescriptions already printed, and the database refuses to remove them
 * whatever any screen asks for.
 */
export function useSetCatalogEntryActive<C extends ReferenceCatalogName>(catalog: C) {
  const invalidate = useCatalogInvalidation(catalog);
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiClient.patch<ReferenceCatalogRows[C]>(`/reference-catalogs/${catalog}/${id}/active`, { active }),
    onSuccess: invalidate,
  });
}
