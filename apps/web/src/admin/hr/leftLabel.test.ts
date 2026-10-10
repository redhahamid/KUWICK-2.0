import { describe, expect, it } from 'vitest';
import { leftLabel } from './leftLabel';

// UAT, 10 October 2026: the day somebody left, beside the word, in the header and the staff list.
describe('leftLabel', () => {
  it('names the day', () => {
    expect(leftLabel('2026-01-07')).toBe('Resigned · 7 Jan 2026');
  });
  it('says only Resigned when the day is not on record', () => {
    expect(leftLabel(null)).toBe('Resigned');
  });
});
