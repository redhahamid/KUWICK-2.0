import { describe, expect, it } from 'vitest';
import { buildAttachmentFormData } from './hooks/useVisitAttachments';

// G0 closure — C0 (D-051) made attachment uploader identity server-derived:
// the controller stopped reading uploadedByStaffId from the request body and
// takes it from the authenticated session instead. The browser nevertheless
// kept appending it to the form data. The server ignored it, so nothing was
// broken — but an attribution field that *looks* client-supplied is exactly
// the kind of thing someone later "fixes" by starting to trust it again.
//
// This test exists so the field cannot quietly come back.
describe('visit attachment upload payload', () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'wound-photo.png', { type: 'image/png' });

  it('sends the file and nothing else', () => {
    const formData = buildAttachmentFormData(file);
    expect([...formData.keys()]).toEqual(['file']);
  });

  it('does not send uploadedByStaffId', () => {
    const formData = buildAttachmentFormData(file);
    expect(formData.has('uploadedByStaffId')).toBe(false);
    expect(formData.get('uploadedByStaffId')).toBeNull();
  });

  it('carries no other staff, user or tenant identity field', () => {
    const formData = buildAttachmentFormData(file);
    const identityish = [...formData.keys()].filter((key) => /staff|user|tenant|clinic|uploaded/i.test(key));
    expect(identityish).toEqual([]);
  });

  it('preserves the file itself unchanged', () => {
    const formData = buildAttachmentFormData(file);
    const sent = formData.get('file') as File;
    expect(sent.name).toBe('wound-photo.png');
    expect(sent.type).toBe('image/png');
    expect(sent.size).toBe(3);
  });
});
