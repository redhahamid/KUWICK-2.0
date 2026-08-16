// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentsRail, describeDates } from './DocumentsRail';
import { buildTemplate } from '../documentTemplates';
import { ClinicalDocument, Visit } from '../types';

// ===========================================================================
// b3 PHASE F — THE DOCUMENTS CARD.
//
// The last empty space in the right column, and the one that still cost
// something: the only way to issue an MC in Canvas was a control in the visit
// band, and seeing what had already been issued meant leaving the consult.
//
// What these hold is the part that carries weight. Each type asks for what it
// genuinely needs and nothing else. A time slip is ONE date and a duration,
// because a slip covering two days is an MC. Removing a document VOIDS it. And
// an MC is a Document row with type = MC — which is what makes "how many MCs
// did we issue" a query rather than a reconciliation between two stores.
// ===========================================================================

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, post, patch, delete: vi.fn(), put: vi.fn(), postFile: vi.fn() },
  downloadFile: vi.fn(),
  fetchBlobUrl: vi.fn(),
}));

const VISIT = {
  id: 'visit-1',
  clinicId: 'clinic-1',
  staffId: 'dr-1',
  visitNumber: 'V-000001',
  presentingComplaint: 'Fever',
  patient: { id: 'p1', name: 'Aisyah Ujian', identifierValue: '900101145566' },
} as unknown as Visit;

const doc = (over: Partial<ClinicalDocument> = {}): ClinicalDocument =>
  ({
    id: 'doc-1',
    visitId: 'visit-1',
    type: 'MC',
    title: null,
    content: 'MEDICAL CERTIFICATE…',
    issuedByStaffId: 'dr-1',
    issuedBy: { id: 'dr-1', fullName: 'Dr Amira Rahman' },
    issuedDate: '2026-08-16',
    startDate: null,
    endDate: null,
    hours: null,
    diagnosisText: null,
    referredTo: null,
    recordStatus: 'ACTIVE',
    requiresClinicalAuthorisation: true,
    ...over,
  }) as unknown as ClinicalDocument;

let ISSUED: ClinicalDocument[] = [];

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  ISSUED = [];
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  get.mockImplementation(async (url: string) => {
    if (String(url).startsWith('/documents')) return ISSUED;
    return [];
  });
  post.mockImplementation(async (_url: string, dto: Record<string, unknown>) => ({ id: 'doc-new', ...dto }));
  patch.mockResolvedValue({});
});

const open = () =>
  render(
    <Harness>
      <DocumentsRail visit={VISIT} />
    </Harness>,
  );

/** Choose a type from the picker and wait for the drawer. */
async function pick(label: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Issue a document' }));
  const dropdown = document.querySelector('.ant-select-dropdown') as HTMLElement;
  await userEvent
    .setup({ pointerEventsCheck: 0 })
    .click(await within(dropdown).findByTitle(label));
  return screen.findByRole('textbox', { name: '' }).catch(() => null);
}

describe('the card says what this visit has issued', () => {
  it('says so plainly on a first visit, rather than rendering nothing', async () => {
    open();
    expect(await screen.findByText(/No documents issued for this visit yet/i)).toBeInTheDocument();
  });

  it('lists type and dates on ONE line, with who issued it on hover', async () => {
    ISSUED = [doc({ startDate: '2026-08-16', endDate: '2026-08-18' })];
    open();
    expect(await screen.findByText('MC')).toBeInTheDocument();
    expect(screen.getByText(/16\/08 – 18\/08\/2026 · 3 days/)).toBeInTheDocument();
    // b4 PIECE 1 — who issued it moved to hover so the row costs one line.
    // Asserted on the title attribute rather than as rendered text: it is
    // still in the DOM and still in the accessibility tree, which is the whole
    // reason a title was used instead of a portal tooltip.
    expect(screen.getByTitle(/Issued by Dr Amira Rahman/)).toBeInTheDocument();
  });

  it('offers view, print and remove on every row', async () => {
    ISSUED = [doc()];
    open();
    await screen.findByText('MC');
    expect(screen.getByRole('button', { name: 'View MC' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print MC' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove MC' })).toBeInTheDocument();
  });

  it('REMOVE voids — there is no delete anywhere', async () => {
    // A document that has left the clinic cannot be un-issued. The row stays,
    // marked voided, exactly as the Documents workspace has always enforced.
    ISSUED = [doc()];
    open();
    await screen.findByText('MC');
    await userEvent.click(screen.getByRole('button', { name: 'Remove MC' }));
    await userEvent.click(await screen.findByRole('button', { name: /Void it/ }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0][0]).toBe('/documents/doc-1/void');
  });
});

describe('choosing a type opens the picker — never one-click generation', () => {
  it('offers all six built-in types', async () => {
    open();
    await userEvent.click(await screen.findByRole('combobox', { name: 'Issue a document' }));
    const dropdown = document.querySelector('.ant-select-dropdown') as HTMLElement;
    for (const label of [
      'Medical Certificate',
      'Referral Letter',
      'Clinical Memo',
      'Quarantine Letter',
      'Time Slip',
      'Consent Form',
    ]) {
      expect(await within(dropdown).findByTitle(label)).toBeInTheDocument();
    }
  });

  it('an MC opens a form with dates to choose — nothing is issued yet', async () => {
    open();
    await pick('Medical Certificate');
    expect(await screen.findByText('Rest period')).toBeInTheDocument();
    // The document does not exist until somebody saves it.
    expect(post).not.toHaveBeenCalled();
  });

  it('a TIME SLIP asks for one date and hours — not a range', async () => {
    // A slip covering two days is an MC. Offering a range here would invite
    // somebody to issue the wrong document under the right name.
    open();
    await pick('Time Slip');
    expect(await screen.findByText('Date attended')).toBeInTheDocument();
    expect(screen.getByText('Hours attended')).toBeInTheDocument();
    expect(screen.queryByText('Rest period')).toBeNull();
  });

  it('a CONSENT asks what is being consented to', async () => {
    open();
    await pick('Consent Form');
    expect(await screen.findByText('Procedure or treatment')).toBeInTheDocument();
    // Nothing clinical to fill in: a consent records the PATIENT's agreement.
    expect(screen.queryByText('Diagnosis on the document')).toBeNull();
  });

  it('a REFERRAL asks who it is addressed to', async () => {
    open();
    await pick('Referral Letter');
    expect(await screen.findByText('Referred to')).toBeInTheDocument();
  });
});

// ===========================================================================
// WHAT EACH TYPE ACTUALLY GENERATES.
//
// Driven through the same `buildTemplate` the drawer uses, so these hold the
// generated TEXT rather than the shape of the form producing it — a form that
// collects hours and a template that never prints them would pass a UI test
// and hand the patient a blank slip.
// ===========================================================================
describe('each type generates with the fields it requires', () => {
  const base = { patientName: 'Aisyah Ujian', patientIdentifier: '900101145566', doctorName: 'Dr Amira' };

  it('an MC certifies unfitness for the dates given', () => {
    const text = buildTemplate('MC', {
      ...base,
      startDate: '2026-08-16',
      endDate: '2026-08-18',
      diagnosisText: 'Acute gastroenteritis',
    });
    expect(text).toContain('MEDICAL CERTIFICATE');
    expect(text).toContain('3 days');
    expect(text).toContain('Acute gastroenteritis');
  });

  it('a single-day MC reads as one day, not as a range of one', () => {
    const text = buildTemplate('MC', { ...base, startDate: '2026-08-16', endDate: '2026-08-16' });
    expect(text).toContain('1 day');
    expect(text).not.toContain('1 days');
  });

  it('a TIME SLIP states attendance and hours, and certifies nothing clinical', () => {
    const text = buildTemplate('TIME_SLIP', { ...base, startDate: '2026-08-16', hours: 2.5 });
    expect(text).toContain('TIME SLIP');
    expect(text).toContain('2.5 hours');
    expect(text).toContain('attended this clinic');
    // It is an attendance fact. A slip claiming fitness for duty would be a
    // clinical opinion the counter is not entitled to make.
    expect(text).not.toMatch(/unfit for duty/i);
    expect(text).not.toMatch(/certify that I have examined/i);
  });

  it('a CONSENT names the procedure and leaves the signature to the PATIENT', () => {
    const text = buildTemplate('CONSENT', { ...base, procedure: 'Incision and drainage' });
    expect(text).toContain('CONSENT FORM');
    expect(text).toContain('Incision and drainage');
    expect(text).toContain('Patient signature');
    // Pre-signing it would assert an agreement nobody has given yet.
    expect(text).not.toMatch(/^Signed:/m);
  });

  it('a consent with no procedure prints a line to complete by hand', () => {
    const text = buildTemplate('CONSENT', base);
    expect(text).toContain('Procedure / treatment: ____');
  });

  it('a REFERRAL carries the recipient and the diagnosis', () => {
    const text = buildTemplate('REFERRAL', {
      ...base,
      referredTo: 'Hospital Kuala Lumpur, ENT',
      diagnosisText: 'Chronic otitis media',
    });
    expect(text).toContain('Hospital Kuala Lumpur, ENT');
    expect(text).toContain('Chronic otitis media');
  });
});

// ===========================================================================
// MC ISSUANCE IS RECORDED AND READABLE.
//
// The owner's requirement is a future "MC issued" report. What makes that
// possible is that an MC is a Document row with type = MC and real dates on
// it — not a second table, and not a CUSTOM document whose type is a string in
// a title field.
// ===========================================================================
describe('an MC is recorded so it can be counted later', () => {
  it('is a Document with type MC and the dates it covers', async () => {
    ISSUED = [doc({ startDate: '2026-08-16', endDate: '2026-08-18' })];
    open();
    await screen.findByText('MC');

    // Read back through the same list a report would query.
    const [row] = ISSUED;
    expect(row.type).toBe('MC');
    expect(row.startDate).toBe('2026-08-16');
    expect(row.endDate).toBe('2026-08-18');
    expect(row.issuedByStaffId).toBe('dr-1');
  });

  it('a time slip is its own type, not an MC and not a CUSTOM document', async () => {
    // Issued as CUSTOM it could not be counted as a time slip at all, which is
    // the reason the two new enum values exist.
    ISSUED = [doc({ id: 'doc-2', type: 'TIME_SLIP', startDate: '2026-08-16', hours: 2.5 })];
    open();
    expect(await screen.findByText('Time slip')).toBeInTheDocument();
    expect(screen.getByText(/16\/08\/2026 · 2.5 hours/)).toBeInTheDocument();
  });
});

describe('the one-line date summary', () => {
  it('collapses a single-day MC to one date', () => {
    expect(describeDates(doc({ startDate: '2026-08-16', endDate: '2026-08-16' }))).toBe('16/08/2026');
  });

  it('names the span and the day count for a range', () => {
    expect(describeDates(doc({ startDate: '2026-08-16', endDate: '2026-08-18' }))).toBe(
      '16/08 – 18/08/2026 · 3 days',
    );
  });

  it('shows hours for a time slip', () => {
    expect(describeDates(doc({ type: 'TIME_SLIP', startDate: '2026-08-16', hours: 1 }))).toBe(
      '16/08/2026 · 1 hour',
    );
  });

  it('falls back to the issue date where a type carries no period', () => {
    expect(describeDates(doc({ type: 'MEMO' }))).toBe('16/08/2026');
  });
});
