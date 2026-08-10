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

const OBSERVATION = {
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
};

// ===========================================================================
// G4.5d3c-3c1 — THE VITALS RESTING STATE
//
// 3c made the fields the panel's resting state, which was right for a visit
// with nothing recorded and wrong for one with a saved reading: the summary
// and an empty form were both on screen, consuming Canvas space to show a
// state nobody asked for. The resting state after a save is compact.
// ===========================================================================
describe('A. a visit with no saved vitals', () => {
  it('1. shows the fields immediately, with no Add step in front of them', async () => {
    renderVitals([]);
    expect(await screen.findByLabelText('Pulse')).toBeInTheDocument();
    expect(screen.getByLabelText('Weight (kg)')).toBeInTheDocument();
    expect(screen.getByLabelText('Height (cm)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^record vitals$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^add/i })).not.toBeInTheDocument();
  });

  it('2. offers Save Vitals straight away', async () => {
    renderVitals([]);
    expect(await screen.findByRole('button', { name: 'Save Vitals' })).toBeInTheDocument();
  });

  it('3. offers no Cancel — there is no saved state to return to', async () => {
    renderVitals([]);
    await screen.findByLabelText('Pulse');
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });
});

describe('B. once vitals are saved the resting state is compact', () => {
  it('4. only the saved summary is shown — the input form is collapsed', async () => {
    const { container } = renderVitals([OBSERVATION]);
    expect(await screen.findByText('120/80')).toBeInTheDocument();
    expect(container.querySelector('[data-vitals-mode="SUMMARY"]')).not.toBeNull();
  });

  it('5. the empty input form is NOT still visible underneath', async () => {
    // This is the defect being corrected.
    renderVitals([OBSERVATION]);
    await screen.findByText('120/80');
    expect(screen.queryByLabelText('Pulse')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Weight (kg)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save Vitals' })).not.toBeInTheDocument();
  });

  it('6. attribution and timestamp travel with the summary', async () => {
    renderVitals([OBSERVATION]);
    expect(await screen.findByText('Siti Aminah')).toBeInTheDocument();
    expect(screen.getByText(/6 Aug 2026/)).toBeInTheDocument();
  });

  it('7. a clear Edit action is offered', async () => {
    renderVitals([OBSERVATION]);
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('8. Record New Reading is a SEPARATE action from Edit', async () => {
    renderVitals([OBSERVATION]);
    expect(await screen.findByRole('button', { name: 'Record New Reading' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('9. the BMI in the summary comes from the saved reading', async () => {
    renderVitals([OBSERVATION]);
    await screen.findByText('120/80');
    expect(screen.getByText('24.2')).toBeInTheDocument();
  });
});

describe('C. Edit', () => {
  it('10. reopens the form populated with the saved values', async () => {
    renderVitals([OBSERVATION]);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    // InputNumber renders a step-formatted value, so 70 may read as "70.0".
    expect(Number((screen.getByLabelText('Pulse') as HTMLInputElement).value)).toBe(72);
    expect(Number((screen.getByLabelText('Weight (kg)') as HTMLInputElement).value)).toBe(70);
    expect(Number((screen.getByLabelText('Height (cm)') as HTMLInputElement).value)).toBe(170);
  });

  it('11. BMI recalculates live when height or weight changes', async () => {
    renderVitals([OBSERVATION]);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const weight = screen.getByLabelText('Weight (kg)');
    await userEvent.clear(weight);
    await userEvent.type(weight, '82');
    const height = screen.getByLabelText('Height (cm)');
    await userEvent.clear(height);
    await userEvent.type(height, '175');
    await waitFor(() => expect(screen.getByTestId('live-bmi').textContent).toMatch(/26\.8/));
  });

  it('12. saving an edit CORRECTS the same reading — it does not create one', async () => {
    patch.mockResolvedValue({ ...OBSERVATION, version: 2 });
    renderVitals([OBSERVATION]);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.type(screen.getByLabelText('Reason for correction'), 'BP transcribed incorrectly');
    await userEvent.click(screen.getByRole('button', { name: 'Save Correction' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    // The CORRECTION endpoint, carrying the target id and its version.
    expect(patch.mock.calls[0][0]).toBe('/visits/visit-1/observations/obs-1');
    expect(patch.mock.calls[0][1]).toMatchObject({ expectedVersion: 1 });
    // And emphatically NOT a new observation.
    expect(post).not.toHaveBeenCalled();
  });

  it('13. an edit does NOT demand a reason — but is still attributed', async () => {
    // U1, owner decision: vitals change routinely mid-consultation. A repeat
    // BP, a re-weigh, a typo'd pulse — none of those are events anybody wants
    // to write a sentence about, and a mandatory field teaches staff to type
    // "correction" and move on, which is a worse record than no sentence.
    //
    // What is unchanged: the server still writes an immutable revision
    // snapshotting the previous values, the editor, their role and the time.
    // Only the prose became optional.
    renderVitals([OBSERVATION]);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save Correction' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(screen.queryByText('A correction requires a reason')).not.toBeInTheDocument();
  });

  it('14. Cancel returns to the compact summary and changes nothing', async () => {
    const { container } = renderVitals([OBSERVATION]);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.clear(screen.getByLabelText('Pulse'));
    await userEvent.type(screen.getByLabelText('Pulse'), '99');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(container.querySelector('[data-vitals-mode="SUMMARY"]')).not.toBeNull();
    expect(screen.queryByLabelText('Pulse')).not.toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});

describe('D. Record New Reading', () => {
  it('15. opens a BLANK form, not the saved values', async () => {
    renderVitals([OBSERVATION]);
    await userEvent.click(await screen.findByRole('button', { name: 'Record New Reading' }));
    expect((screen.getByLabelText('Pulse') as HTMLInputElement).value).toBe('');
  });

  it('16. asks for no correction reason — it is not a correction', async () => {
    renderVitals([OBSERVATION]);
    await userEvent.click(await screen.findByRole('button', { name: 'Record New Reading' }));
    expect(screen.queryByLabelText('Reason for correction')).not.toBeInTheDocument();
  });

  it('17. saving it CREATES a reading rather than correcting one', async () => {
    post.mockResolvedValue({ id: 'obs-2' });
    renderVitals([OBSERVATION]);
    await userEvent.click(await screen.findByRole('button', { name: 'Record New Reading' }));
    await userEvent.type(screen.getByLabelText('Pulse'), '88');
    await userEvent.click(screen.getByRole('button', { name: 'Save Vitals' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe('/visits/visit-1/observations');
    expect(patch).not.toHaveBeenCalled();
  });

  it('18. after saving, the panel returns to the compact resting state', async () => {
    post.mockResolvedValue({ id: 'obs-2' });
    const { container } = renderVitals([OBSERVATION]);
    await userEvent.click(await screen.findByRole('button', { name: 'Record New Reading' }));
    await userEvent.type(screen.getByLabelText('Pulse'), '88');
    await userEvent.click(screen.getByRole('button', { name: 'Save Vitals' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    await waitFor(() =>
      expect(container.querySelector('[data-vitals-mode="SUMMARY"]')).not.toBeNull(),
    );
    expect(screen.queryByLabelText('Pulse')).not.toBeInTheDocument();
  });

  it('19. Cancel returns to the summary without writing', async () => {
    const { container } = renderVitals([OBSERVATION]);
    await userEvent.click(await screen.findByRole('button', { name: 'Record New Reading' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(container.querySelector('[data-vitals-mode="SUMMARY"]')).not.toBeNull();
    expect(post).not.toHaveBeenCalled();
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

    const save = screen.getByRole('button', { name: 'Save Vitals' });
    await userEvent.click(save);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // Submit again while the first is still in flight.
    await userEvent.type(screen.getByLabelText('Pulse'), '{Enter}');

    expect(post).toHaveBeenCalledTimes(1);
    resolve({ id: 'obs-1' });
  });

  it('13. an empty form is not sent to the server at all', async () => {
    renderVitals();
    await userEvent.click(await screen.findByRole('button', { name: 'Save Vitals' }));
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

  it('15. the picker offers exactly the four types the SERVER accepts', async () => {
    // G4.5d3c-3c1 — narrowed from `image/*`. This is a convenience so the
    // dialog stops offering files that will be refused on arrival; it is NOT
    // the control. Enforcement is server-side, and its own spec proves it.
    renderAttachments();
    const input = (await screen.findByLabelText(
      'Choose files to attach to this visit',
    )) as HTMLInputElement;
    expect(input.accept).toBe('image/jpeg,image/png,image/webp,application/pdf');
    expect(input.accept).not.toContain('image/*');
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
    // The failure names its reason, so "Failed" alone is no longer the text.
    expect(screen.getByText(/File too large/)).toBeInTheDocument();
  });

  it('18b. the refused file shows the SERVER\'s reason as visible text', async () => {
    // Not a tooltip: unreachable on a touch screen, invisible to anyone
    // scanning the list, and the doctor needs an answer they can act on.
    // The refused file is one the PICKER allows — a .pdf whose bytes are not
    // a PDF. That is the only refusal a browser can actually produce: the
    // accept attribute filters by declared type, and only the server reads
    // the leading bytes. (A genuinely mistyped file never reaches the handler
    // at all, which `userEvent.upload` faithfully reproduces.)
    postFile
      .mockResolvedValueOnce({ id: 'a' })
      .mockRejectedValueOnce(new MockApiError('Unsupported file type. Upload JPG, PNG, WebP or PDF.'));
    renderAttachments();
    await screen.findByLabelText('Choose files to attach to this visit');
    await chooseFiles([file('a.png', 'image/png'), file('payload.pdf', 'application/pdf')]);

    // The icon splits the text node, so the assertion reads the rendered
    // element rather than a single text node.
    const failure = await screen.findByText(
      (_content, element) =>
        element?.getAttribute('data-upload-error') === 'payload.pdf',
    );
    expect(failure.textContent).toContain('Unsupported file type. Upload JPG, PNG, WebP or PDF.');
    // And the permitted file in the same selection still landed.
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
  });

  it('18c. the per-file error is attached to the file it belongs to', async () => {
    postFile
      .mockResolvedValueOnce({ id: 'a' })
      .mockRejectedValueOnce(new MockApiError('Unsupported file type. Upload JPG, PNG, WebP or PDF.'));
    const { container } = renderAttachments();
    await screen.findByLabelText('Choose files to attach to this visit');
    await chooseFiles([file('good.png', 'image/png'), file('bad.pdf', 'application/pdf')]);

    await waitFor(() =>
      expect(container.querySelector('[data-upload-error="bad.pdf"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-upload-error="good.png"]')).toBeNull();
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

// ===========================================================================
// G4.5d3c-3c1 — WHAT SAVING VITALS MUST NOT TOUCH
// ===========================================================================
describe('vitals never disturb the clinical note', () => {
  const OBS = {
    id: 'obs-1',
    pulse: 72,
    version: 1,
    recordedAt: '2026-08-06T02:00:00.000Z',
    recorderNameSnapshot: 'Siti Aminah',
    recorderRoleSnapshot: 'FRONT_DESK_CLINICAL_STAFF',
    legacyRecorderUnknown: false,
  };

  const renderWithSpy = (observations: unknown[]) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    get.mockResolvedValue(observations);
    const result = render(
      <QueryClientProvider client={client}>
        <VisitObservationsPanel visitId="visit-1" />
      </QueryClientProvider>,
    );
    return { ...result, invalidate };
  };

  const invalidatedKeys = (invalidate: ReturnType<typeof vi.spyOn>) =>
    invalidate.mock.calls.flatMap((call: unknown[]) => {
      const key = (call[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
      return Array.isArray(key) ? [String(key[0])] : [];
    });

  it('20. saving a reading does not refetch clinical notes', async () => {
    post.mockResolvedValue({ id: 'obs-2' });
    const { invalidate } = renderWithSpy([]);
    await userEvent.type(await screen.findByLabelText('Pulse'), '72');
    await userEvent.click(screen.getByRole('button', { name: 'Save Vitals' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const keys = invalidatedKeys(invalidate);
    expect(keys).toContain('visit-observations');
    expect(keys).not.toContain('clinical-notes');
    expect(keys).not.toContain('visits');
  });

  it('21. correcting a reading does not refetch clinical notes either', async () => {
    patch.mockResolvedValue({ ...OBS, version: 2 });
    const { invalidate } = renderWithSpy([OBS]);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.type(screen.getByLabelText('Reason for correction'), 'Mistyped');
    await userEvent.click(screen.getByRole('button', { name: 'Save Correction' }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(invalidatedKeys(invalidate)).not.toContain('clinical-notes');
  });

  it('22. a double-click on Save still produces ONE logical result', async () => {
    let resolve: (value: unknown) => void = () => {};
    post.mockReturnValue(new Promise((r) => (resolve = r)));
    renderVitals([]);
    await userEvent.type(await screen.findByLabelText('Pulse'), '72');

    const save = screen.getByRole('button', { name: 'Save Vitals' });
    await userEvent.click(save);
    await userEvent.click(save);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    resolve({ id: 'obs-1' });
  });

  it('23. the compact summary wraps rather than overflowing on a phone', async () => {
    // A horizontally scrolling row of clinical values is a row whose
    // right-hand half nobody reads.
    const { container } = renderVitals([OBS]);
    await screen.findByText('Siti Aminah');
    const line = container.querySelector('.kw-vitals-line');
    expect(line).not.toBeNull();
    expect(container.querySelector('.kw-vitals-summary')).not.toBeNull();
  });
});
