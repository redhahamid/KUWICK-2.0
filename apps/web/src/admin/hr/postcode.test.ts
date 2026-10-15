import { describe, expect, it } from 'vitest';
import { placeOfPostcode } from './postcode';

// The open postcode list fills town and state (new-clinic UAT, 15 October 2026).
describe('placeOfPostcode', () => {
  it('gives the town and the state as the forms name it', async () => {
    expect(await placeOfPostcode('43650')).toEqual({ town: 'Bandar Baru Bangi', state: 'Selangor' });
    expect((await placeOfPostcode('50450'))?.state).toBe('W.P. Kuala Lumpur');
  });
  it('says nothing for a postcode that is not one', async () => {
    expect(await placeOfPostcode('4365')).toBeNull();
    expect(await placeOfPostcode('00000')).toBeNull();
  });
});
