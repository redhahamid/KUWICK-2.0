/**
 * THE SELECTION EDITOR'S ARITHMETIC — pure, so it can be tested against the
 * engine's own rules rather than trusted.
 *
 * The server decides everything that matters (the applied base, the
 * discrepancy, the block); what the browser derives here is only the PREVIEW a
 * person reads before saving: which components their ticks would leave out of
 * the basis despite being assessed as EPF wages, and which ticks would add
 * nothing because the assessment keeps the component out anyway. The words
 * beside a checkbox must agree with what the run will do — a preview that
 * promises differently from the engine is the client-side arithmetic defect
 * this branch spent a validation cycle removing.
 */

export type BasisMode = 'BASIC_ONLY' | 'BASIC_PLUS_SELECTED' | 'ALL_APPLICABLE';

export interface BasisComponentOption {
  code: string;
  label: string;
  /** The statutory assessment: is this component EPF wages? */
  epfLiable: boolean;
  verification: string;
  sourceRef: string | null;
}

export interface BasisPreview {
  /** Assessed-liable components the selection would leave out — each one a
   * blocking statutory discrepancy in any month that pays it. */
  excludedLiable: BasisComponentOption[];
  /** Ticked components the assessment keeps out of EPF wages regardless. */
  ineffective: BasisComponentOption[];
}

export const MODE_WORDS: Record<BasisMode, string> = {
  BASIC_ONLY: 'Basic salary only',
  BASIC_PLUS_SELECTED: 'Basic + selected income',
  ALL_APPLICABLE: 'All applicable earnings (the statutory assessment)',
};

export function basisPreview(
  components: readonly BasisComponentOption[],
  mode: BasisMode,
  tickedCodes: readonly string[],
): BasisPreview {
  if (mode === 'ALL_APPLICABLE') return { excludedLiable: [], ineffective: [] };
  const ticked = new Set(tickedCodes);
  const nonBasic = components.filter((component) => component.code !== 'BASIC');
  return {
    excludedLiable: nonBasic.filter(
      (component) => component.epfLiable && (mode === 'BASIC_ONLY' || !ticked.has(component.code)),
    ),
    ineffective:
      mode === 'BASIC_ONLY'
        ? []
        : nonBasic.filter((component) => !component.epfLiable && ticked.has(component.code)),
  };
}
