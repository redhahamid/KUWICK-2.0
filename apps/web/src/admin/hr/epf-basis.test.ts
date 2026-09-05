import { describe, expect, it } from 'vitest';
import { BasisComponentOption, basisPreview } from './epf-basis';

/**
 * The preview a person reads before saving a basis must promise exactly what
 * the engine will do — a preview that differs from the run is the client-side
 * arithmetic defect the validation cycle exists to keep out.
 */
const component = (code: string, epfLiable: boolean): BasisComponentOption => ({
  code,
  label: code,
  epfLiable,
  verification: 'DRAFT',
  sourceRef: null,
});

const CATALOGUE = [
  component('BASIC', true),
  component('COMMISSION', true),
  component('ALLOWANCE', true),
  component('OVERTIME', false),
  component('LOCUM_FEE', false),
];

describe('basisPreview', () => {
  it('ALL_APPLICABLE previews no exclusions and no dead ticks', () => {
    expect(basisPreview(CATALOGUE, 'ALL_APPLICABLE', [])).toEqual({ excludedLiable: [], ineffective: [] });
  });

  it('BASIC_ONLY names every assessed-liable component it would leave out — and only those', () => {
    const preview = basisPreview(CATALOGUE, 'BASIC_ONLY', []);
    expect(preview.excludedLiable.map((c) => c.code)).toEqual(['COMMISSION', 'ALLOWANCE']);
    // Overtime and the locum fee are outside EPF wages by the ASSESSMENT —
    // leaving them out is the Act's doing, so they are not a discrepancy.
    expect(preview.ineffective).toEqual([]);
  });

  it('BASIC_PLUS_SELECTED follows the ticks: unticked liable is a discrepancy, ticked non-liable adds nothing', () => {
    const preview = basisPreview(CATALOGUE, 'BASIC_PLUS_SELECTED', ['COMMISSION', 'OVERTIME']);
    expect(preview.excludedLiable.map((c) => c.code)).toEqual(['ALLOWANCE']);
    expect(preview.ineffective.map((c) => c.code)).toEqual(['OVERTIME']);
  });

  it('BASIC never appears in either list — it is always in the basis', () => {
    const basicOnly = basisPreview(CATALOGUE, 'BASIC_ONLY', []);
    const selected = basisPreview(CATALOGUE, 'BASIC_PLUS_SELECTED', []);
    for (const preview of [basicOnly, selected]) {
      expect(preview.excludedLiable.some((c) => c.code === 'BASIC')).toBe(false);
      expect(preview.ineffective.some((c) => c.code === 'BASIC')).toBe(false);
    }
  });

  it('ticking every liable component previews a clean month', () => {
    const preview = basisPreview(CATALOGUE, 'BASIC_PLUS_SELECTED', ['COMMISSION', 'ALLOWANCE']);
    expect(preview.excludedLiable).toEqual([]);
    expect(preview.ineffective).toEqual([]);
  });
});
