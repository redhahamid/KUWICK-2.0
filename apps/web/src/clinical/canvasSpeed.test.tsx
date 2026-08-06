// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';
import { VisitObservationsPanel } from './VisitObservationsPanel';
import { VisitAttachmentsPanel } from './VisitAttachmentsPanel';
import { FOCUS_MODE_CLASS } from './ClinicalNotesTab';

// ===========================================================================
// G4.5d3c-3c — THE CANVAS SPEED CLOSURES, IN THE DOM
//
// Three of the owner's seven items are only really testable at this level:
// whether the vitals fields are THERE without an Add click, whether BMI
// appears while typing, and whether choosing four files uploads four files.
// ===========================================================================

const { get, post, patch, postFile, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), postFile: vi.fn(), MockApiError };
});
vi.mock('../core/api-client', () => ({
  ApiError: MockApiError,
  apiClient: { get, post, patch, postFile, delete: vi.fn() },
  downloadFile: vi.fn(),
  fetchBlobUrl: vi.fn(async () => 'blob:image'),
}));

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  postFile.mockReset();
  // A leftover toast from a previous test is the first role="alert" on the
  // page and silently answers the next assertion.
  message.destroy();
  document.body.classList.remove(FOCUS_MODE_CLASS);
});

// ---------------------------------------------------------------------------
// Vitals: the fields are simply there
// ---------------------------------------------------------------------------
const renderVitals = (observations: unknown[] = [], props: Record<string, unknown> = {}) => {
  get.mockResolvedValue(observations);
  return render(
    <Harness>
      <VisitObservationsPanel visitId="visit-1" {...props} />
    </Harness>,
  );
};

describe('vitals entry needs no Add click', () => {
  it('1. the fields are present on an empty visit', async () => {
    renderVitals();
    expect(await screen.findByLabelText('Pulse')).toBeInTheDocument();
    expect(screen.getByLabelText('Weight (kg)')).toBeInTheDocument();
    expect(screen.getByLabelText('Height (cm)')).toBeInTheDocument();
  });

  it('2. there is no Record vitals / Add step in front of them', async () => {
    renderVitals();
    await screen.findByLabelText('Pulse');
    expect(screen.queryByRole('button', { name: /^record vitals$/i })).not.toBeInTheDocument();
  });

  it('3. Save is available immediately', async () => {
    renderVitals();
    expect(await screen.findByRole('button', { name: 'Save Observations' })).toBeInTheDocument();
  });

  it('4. a saved reading appears as a compact summary ABOVE the fields', async () => {
    renderVitals([
      {
        id: 'obs-1',
        bpSystolic: 120,
        bpDiastolic: 80,
        pulse: 72,
        temperature: '36.8',
        weight: '70',
        height: '170',
        bmi: 24.2,
        version: 1,
        recordedAt: '2026-08-06T02:00:00.000Z',
        recorderNameSnapshot: 'Siti Aminah',
        recorderRoleSnapshot: 'FRONT_DESK_CLINICAL_STAFF',
        legacyRecorderUnknown: false,
      },
    ]);
    expect(await screen.findByText('120/80')).toBeInTheDocument();
    // Still editable: the fields have not been replaced by a read-only view.
    expect(screen.getByLabelText('Pulse')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Correct' })).toBeInTheDocument();
  });

  it('4b. on the Canvas the panel opens WITH the fields, not collapsed again', async () => {
    // Caught by the screenshot pass, not by these tests: the Canvas mounts
    // this panel only after the doctor pressed "Record / Edit" on the vitals
    // strip, and it was opening as a collapsed summary — so the fields were
    // still a second click away, which is the friction 3c removes.
    renderVitals(
      [
        {
          id: 'obs-1',
          pulse: 72,
          version: 1,
          recordedAt: '2026-08-06T02:00:00.000Z',
          recorderNameSnapshot: 'Siti Aminah',
          recorderRoleSnapshot: 'FRONT_DESK_CLINICAL_STAFF',
          legacyRecorderUnknown: false,
        },
      ],
      { compact: true, defaultExpanded: true },
    );
    expect(await screen.findByLabelText('Pulse')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Observations' })).toBeInTheDocument();
  });

  it('4c. in Flow, where the panel is always on screen, it still opens compact', async () => {
    renderVitals(
      [
        {
          id: 'obs-1',
          pulse: 72,
          version: 1,
          recordedAt: '2026-08-06T02:00:00.000Z',
          recorderNameSnapshot: 'Siti Aminah',
          recorderRoleSnapshot: 'FRONT_DESK_CLINICAL_STAFF',
          legacyRecorderUnknown: false,
        },
      ],
      { compact: true },
    );
    await screen.findByText(/Siti Aminah/);
    expect(screen.queryByLabelText('Pulse')).not.toBeInTheDocument();
  });

  it('5. the summary keeps the recorder attribution', async () => {
    renderVitals([
      {
        id: 'obs-1',
        pulse: 72,
        version: 1,
        recordedAt: '2026-08-06T02:00:00.000Z',
        recorderNameSnapshot: 'Siti Aminah',
        recorderRoleSnapshot: 'FRONT_DESK_CLINICAL_STAFF',
        legacyRecorderUnknown: false,
      },
    ]);
    expect(await screen.findByText('Siti Aminah')).toBeInTheDocument();
  });
});

describe('BMI is live', () => {
  it('6. it says what it needs before both values exist', async () => {
    renderVitals();
    await screen.findByLabelText('Pulse');
    expect(screen.getByTestId('live-bmi').textContent).toMatch(/enter height and weight/i);
  });

  it('7. it appears while the fields are being typed — no Save, no Calculate', async () => {
    renderVitals();
    await userEvent.type(await screen.findByLabelText('Weight (kg)'), '70');
    await userEvent.type(screen.getByLabelText('Height (cm)'), '170');
    await waitFor(() => expect(screen.getByTestId('live-bmi').textContent).toMatch(/24\.2/));
    // There is no Calculate control at all.
    expect(screen.queryByRole('button', { name: /calculate/i })).not.toBeInTheDocument();
  });

  it('8. typing costs no network request', async () => {
    renderVitals();
    const before = post.mock.calls.length + patch.mock.calls.length;
    await userEvent.type(await screen.findByLabelText('Weight (kg)'), '70');
    await userEvent.type(screen.getByLabelText('Height (cm)'), '170');
    await waitFor(() => expect(screen.getByTestId('live-bmi').textContent).toMatch(/24\.2/));
    expect(post.mock.calls.length + patch.mock.calls.length).toBe(before);
  });

  it('9. it updates as the numbers change', async () => {
    renderVitals();
    const weight = await screen.findByLabelText('Weight (kg)');
    await userEvent.type(weight, '70');
    await userEvent.type(screen.getByLabelText('Height (cm)'), '170');
    await waitFor(() => expect(screen.getByTestId('live-bmi').textContent).toMatch(/24\.2/));
    await userEvent.clear(weight);
    await userEvent.type(weight, '95');
    await waitFor(() => expect(screen.getByTestId('live-bmi').textContent).toMatch(/32\.9/));
  });

  it('10. an impossible pair never prints NaN or Infinity', async () => {
    renderVitals();
    await userEvent.type(await screen.findByLabelText('Weight (kg)'), '70');
    await userEvent.type(screen.getByLabelText('Height (cm)'), '0');
    const text = screen.getByTestId('live-bmi').textContent ?? '';
    expect(text).not.toMatch(/NaN|Infinity/);
  });

  it('11. the readout is announced, not only drawn', async () => {
    renderVitals();
    await screen.findByLabelText('Pulse');
    expect(screen.getByTestId('live-bmi')).toHaveAttribute('aria-live', 'polite');
  });
});

describe('vitals cannot be saved twice by pressing Enter twice', () => {
  it('12. the second submission is refused, and says why', async () => {
    // The reported defect: the Save button carries `loading`, which stops a
    // second CLICK — but Enter submits the form without consulting it.
    let resolve: (value: unknown) => void = () => {};
    post.mockReturnValue(new Promise((r) => (resolve = r)));
    renderVitals();
    await userEvent.type(await screen.findByLabelText('Pulse'), '72');

    const save = screen.getByRole('button', { name: 'Save Observations' });
    await userEvent.click(save);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // Submit again while the first is still in flight.
    await userEvent.type(screen.getByLabelText('Pulse'), '{Enter}');

    expect(post).toHaveBeenCalledTimes(1);
    resolve({ id: 'obs-1' });
  });

  it('13. an empty form is not sent to the server at all', async () => {
    renderVitals();
    await userEvent.click(await screen.findByRole('button', { name: 'Save Observations' }));
    expect(post).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------
const file = (name: string, type: string) => new File([new Uint8Array(8)], name, { type });

const renderAttachments = (attachments: unknown[] = []) => {
  get.mockResolvedValue(attachments);
  return render(
    <Harness>
      <VisitAttachmentsPanel visitId="visit-1" />
    </Harness>,
  );
};

const chooseFiles = async (files: File[]) => {
  const input = screen.getByLabelText('Choose files to attach to this visit') as HTMLInputElement;
  await userEvent.upload(input, files);
};

describe('several files can be attached at once', () => {
  it('14. the picker accepts multiple files', async () => {
    renderAttachments();
    const input = (await screen.findByLabelText(
      'Choose files to attach to this visit',
    )) as HTMLInputElement;
    expect(input.multiple).toBe(true);
  });

  it('15. images and PDFs may be chosen together', async () => {
    renderAttachments();
    const input = (await screen.findByLabelText(
      'Choose files to attach to this visit',
    )) as HTMLInputElement;
    expect(input.accept).toContain('image/*');
    expect(input.accept).toContain('application/pdf');
  });

  it('16. EVERY chosen file is uploaded, not just the first', async () => {
    postFile.mockResolvedValue({ id: 'a' });
    renderAttachments();
    await screen.findByLabelText('Choose files to attach to this visit');
    await chooseFiles([
      file('page1.pdf', 'application/pdf'),
      file('wound.jpg', 'image/jpeg'),
      file('page2.pdf', 'application/pdf'),
    ]);
    await waitFor(() => expect(postFile).toHaveBeenCalledTimes(3));
  });

  it('17. each file reports its own result', async () => {
    postFile.mockResolvedValue({ id: 'a' });
    renderAttachments();
    await screen.findByLabelText('Choose files to attach to this visit');
    await chooseFiles([file('a.png', 'image/png'), file('b.pdf', 'application/pdf')]);
    await waitFor(() => expect(screen.getAllByText('Uploaded')).toHaveLength(2));
    expect(screen.getByText('a.png')).toBeInTheDocument();
    expect(screen.getByText('b.pdf')).toBeInTheDocument();
  });

  it('18. ONE failure does not cancel the others', async () => {
    postFile
      .mockResolvedValueOnce({ id: 'a' })
      .mockRejectedValueOnce(new MockApiError('File too large'))
      .mockResolvedValueOnce({ id: 'c' });
    renderAttachments();
    await screen.findByLabelText('Choose files to attach to this visit');
    await chooseFiles([
      file('a.png', 'image/png'),
      file('big.pdf', 'application/pdf'),
      file('c.png', 'image/png'),
    ]);

    await waitFor(() => expect(postFile).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getAllByText('Uploaded')).toHaveLength(2));
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('19. the successes are stated as successes, so nobody re-uploads them', async () => {
    postFile.mockResolvedValueOnce({ id: 'a' }).mockRejectedValueOnce(new MockApiError('nope'));
    renderAttachments();
    await screen.findByLabelText('Choose files to attach to this visit');
    await chooseFiles([file('a.png', 'image/png'), file('b.pdf', 'application/pdf')]);
    await waitFor(() =>
      expect(screen.getByText(/do not need to be sent again/i)).toBeInTheDocument(),
    );
  });
});

describe('a PDF presents as a document', () => {
  const pdf = {
    id: 'att-pdf',
    fileName: 'referral-letter.pdf',
    mimeType: 'application/pdf',
    fileSize: 2048,
    version: 1,
    recordStatus: 'ACTIVE',
    createdAt: '2026-08-06T02:00:00.000Z',
    uploadedBy: { fullName: 'Siti Aminah' },
  };

  it('20. it is rendered as a file card, not as an image', async () => {
    renderAttachments([pdf]);
    expect(await screen.findByText('referral-letter.pdf')).toBeInTheDocument();
    expect(screen.getByLabelText('PDF document')).toBeInTheDocument();
    // The one thing that must never happen: an <img> pointed at PDF bytes.
    expect(document.querySelector('img[alt="referral-letter.pdf"]')).toBeNull();
  });

  it('21. the row is marked as a PDF for the rest of the page', async () => {
    const { container } = renderAttachments([pdf]);
    await screen.findByText('referral-letter.pdf');
    expect(container.querySelector('[data-attachment-kind="PDF"]')).not.toBeNull();
  });

  it('22. its size and uploader still travel with it', async () => {
    renderAttachments([pdf]);
    expect(await screen.findByText(/2 KB/)).toBeInTheDocument();
    expect(screen.getByText(/Siti Aminah/)).toBeInTheDocument();
  });
});
