// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicalNotesTab } from './ClinicalNotesTab';
import { useClinicalDraftStore } from './clinical-draft-store';

// ===========================================================================
// b0 — ATTACHMENTS ARE ONE COMPONENT WITH ONE STATE.
//
// Reported: after uploading a file on the Canvas, "Attachments (N)" appeared
// TWICE — once as a summary strip, once inside the panel that the strip's own
// Upload button revealed — the thumbnail was duplicated, and the Hide/Upload
// pair sat over the note area.
//
// Root cause: two components, `ClinicalImageStrip` and
// `VisitAttachmentsPanel`, each rendered the same attachment list with its own
// heading and its own Upload, and the page mounted both. Each was correct in
// isolation, and every test either of them had passed throughout. That is the
// shape of this defect family: a duplicate is invisible to a test that renders
// one of the duplicates.
//
// So the assertions here are about the COUNT, on the assembled note tab, in
// both layouts. The companion fact — that the app mounts the component in
// exactly ONE place — is in attachmentsSingleMount.test.ts, because a second
// mount added to a page these tests do not render would reintroduce exactly
// the reported symptom and no rendered assertion here could see it.
// ===========================================================================

const { get, post, patch, postFile } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  postFile: vi.fn(),
}));
vi.mock('../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, post, patch, postFile, delete: vi.fn() },
  downloadFile: vi.fn(),
  fetchBlobUrl: vi.fn(async () => 'blob:x'),
}));

vi.mock('../core/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      staff: { id: 'doc-1', role: 'DOCTOR_RESIDENT', clinicId: 'clinic-1', fullName: 'Dr Amira', canAuthorNarrative: true },
      tenant: { id: 'tenant-1' },
    }),
}));

vi.mock('./RichTextEditor', () => ({
  RichTextEditor: ({ content, onChange }: { content: string; onChange: (html: string) => void }) => (
    <textarea aria-label="Clinical note" value={content} onChange={(e) => onChange(e.target.value)} />
  ),
}));

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ATTACHMENT = {
  id: 'att-1',
  visitId: 'visit-1',
  fileName: 'ear-left.png',
  mimeType: 'image/png',
  fileSize: 4096,
  version: 1,
  recordStatus: 'ACTIVE',
  category: 'PHOTO',
  createdAt: '2026-08-13T02:00:00.000Z',
  uploadedBy: { fullName: 'Dr Amira' },
};

let attachments: unknown[] = [];

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  postFile.mockReset();
  attachments = [];
  useClinicalDraftStore.setState({ drafts: {} });
  get.mockImplementation(async (url: string) => (String(url).includes('attachments') ? attachments : []));
  postFile.mockImplementation(async () => {
    attachments = [ATTACHMENT];
    return ATTACHMENT;
  });
});

/** `embedded` is the Canvas mount; the plain one is Flow. */
const renderNotes = (embedded: boolean) =>
  render(
    <Harness>
      <ClinicalNotesTab visitId="visit-1" patientId="patient-1" embedded={embedded} />
    </Harness>,
  );

const regions = () => document.querySelectorAll('[data-attachments-region="visit"]');

for (const [label, embedded] of [
  ['canvas (embedded)', true],
  ['flow', false],
] as const) {
  describe(`${label}: one attachments region`, () => {
    it('renders exactly one region before anything is attached', async () => {
      renderNotes(embedded);
      await screen.findByLabelText('Choose files to attach to this visit');
      expect(regions()).toHaveLength(1);
      expect(screen.getAllByText(/^Attachments \(0\)$/)).toHaveLength(1);
    });

    // The reported condition. Before the upload the duplicate was not visible
    // either, which is how it reached the owner.
    it('renders exactly one region AFTER a file is uploaded', async () => {
      renderNotes(embedded);
      const input = await screen.findByLabelText('Choose files to attach to this visit');
      await userEvent.upload(input, new File([new Uint8Array(8)], 'ear-left.png', { type: 'image/png' }));

      await waitFor(() => expect(document.querySelectorAll('.kw-attachment-chip')).toHaveLength(1));
      expect(regions()).toHaveLength(1);
      expect(screen.getAllByText(/^Attachments \(1\)$/)).toHaveLength(1);
      // And the file's name is printed ONCE. The upload progress row reports
      // the same name while the request is in flight, which is right, but a
      // finished successful batch that keeps its list prints every filename
      // twice — the same complaint as the doubled heading.
      await waitFor(() => expect(screen.getAllByText('ear-left.png')).toHaveLength(1));
    });

    it('a FAILED upload keeps its reason on screen', async () => {
      // The other side of the rule above: the progress list clears itself only
      // when there is nothing left to explain.
      postFile.mockRejectedValueOnce(new Error('Unsupported file type. Upload JPG, PNG, WebP or PDF.'));
      renderNotes(embedded);
      const input = await screen.findByLabelText('Choose files to attach to this visit');
      await userEvent.upload(input, new File([new Uint8Array(8)], 'payload.pdf', { type: 'application/pdf' }));

      await waitFor(() => expect(screen.getByText('payload.pdf')).toBeInTheDocument());
      expect(regions()).toHaveLength(1);
    });

    it('has exactly one Upload control and no Hide', async () => {
      // The strip's Upload button doubled as a Hide toggle for the panel
      // below it, so the region had two Uploads and a control whose label
      // changed under the doctor's cursor.
      renderNotes(embedded);
      await screen.findByLabelText('Choose files to attach to this visit');
      expect(screen.getAllByRole('button', { name: /upload/i })).toHaveLength(1);
      expect(screen.queryByRole('button', { name: /^hide$/i })).toBeNull();
    });
  });
}

describe('the chip states what kind of file it is', () => {
  beforeEach(() => {
    attachments = [
      ATTACHMENT,
      { ...ATTACHMENT, id: 'att-2', fileName: 'fbc.pdf', mimeType: 'application/pdf', category: 'LAB' },
      // The case that proves the tag is stored and not derived: an IMAGE
      // filed as a letter, exactly as the approved canvas shows
      // `referral-hosp.jpg`.
      { ...ATTACHMENT, id: 'att-3', fileName: 'referral-hosp.jpg', mimeType: 'image/jpeg', category: 'LETTER' },
    ];
  });

  it('marks each chip with its own kind', async () => {
    renderNotes(true);
    await screen.findByText('fbc.pdf');
    expect(document.querySelectorAll('[data-attachment-category="PHOTO"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-attachment-category="LAB"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-attachment-category="LETTER"]')).toHaveLength(1);
  });

  it('an image filed as a LETTER keeps that kind — the tag is not re-derived from the MIME type', async () => {
    renderNotes(true);
    await screen.findByText('referral-hosp.jpg');
    const chip = [...document.querySelectorAll('.kw-attachment-chip')].find((element) =>
      element.textContent?.includes('referral-hosp.jpg'),
    );
    expect(chip?.getAttribute('data-attachment-category')).toBe('LETTER');
  });

  it('the kind is announced in words, not by colour alone', async () => {
    renderNotes(true);
    await screen.findByText('fbc.pdf');
    expect(screen.getByLabelText('Filed as lab')).toBeInTheDocument();
    expect(screen.getByLabelText('Filed as letter')).toBeInTheDocument();
    expect(screen.getByLabelText('Filed as photo')).toBeInTheDocument();
  });

  it('re-filing sends the new kind and the version it was read at', async () => {
    patch.mockResolvedValue({ ...ATTACHMENT, category: 'LETTER', version: 2 });
    renderNotes(true);
    await screen.findByText('ear-left.png');

    await userEvent.click(screen.getByLabelText('Filed as photo'));
    await userEvent.click(await screen.findByText('letter'));

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/visits/visit-1/attachments/att-1/category', {
        category: 'LETTER',
        expectedVersion: 1,
      }),
    );
  });
});

describe('removal is still the audited one', () => {
  beforeEach(() => {
    attachments = [ATTACHMENT];
  });

  it('the × asks for a reason before anything is removed', async () => {
    renderNotes(true);
    await screen.findByText('ear-left.png');
    await userEvent.click(screen.getByLabelText('Remove ear-left.png'));

    expect(await screen.findByText(/Remove file from visit/i)).toBeInTheDocument();
    // Nothing has been sent: removal is reason-bearing, so the click opens a
    // question rather than performing the removal.
    expect(patch).not.toHaveBeenCalled();
  });
});
