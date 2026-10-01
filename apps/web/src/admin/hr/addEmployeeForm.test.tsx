// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { App as AntApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADD EMPLOYEE, ON THE FORM ITSELF.
 *
 * The first month's UAT found four things on this form that a clinic hits on
 * the first person they add: an IC box that took anything (and a passport
 * that had nowhere to go), a phone box with no country, a relationship box
 * that wanted the same five words typed, and a nationality question a
 * Malaysian citizen should never be asked. None of it needed the server.
 */
const post = vi.fn();
const patch = vi.fn();
vi.mock('../../core/api-client', () => ({
  apiClient: { post: (...args: unknown[]) => post(...args), patch: (...args: unknown[]) => patch(...args) },
  ApiError: class ApiError extends Error {},
}));
vi.mock('../hooks/useAdmin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useAdmin')>()),
  useLegalEmployers: () => ({ data: [{ id: 'emp-1', name: 'Klinik Contoh Sdn Bhd', active: true }] }),
}));
vi.mock('../../core/hooks/useClinics', () => ({
  useClinics: () => ({ data: [{ id: 'clinic-1', name: 'Klinik Contoh' }] }),
}));
vi.mock('../../core/hooks/useClinicFilter', () => ({
  useClinicFilter: () => ({ clinicId: 'clinic-1', setClinicId: () => {}, clinics: [], showSelector: false, mayViewAllBranches: true }),
}));
vi.mock('../components/AdminShell', () => ({
  AdminShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { AddEmployeePage } = await import('./AddEmployeePage');

function open() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AntApp>
        <MemoryRouter>
          <AddEmployeePage />
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

/** antd's Select is a combobox: open it, click the option by its title, and let the form's watchers catch up. */
async function choose(label: string, option: string) {
  fireEvent.mouseDown(screen.getByLabelText(label));
  fireEvent.click(await screen.findByTitle(option));
  await act(async () => {});
}

const continueButton = () => screen.getByRole('button', { name: 'Continue' });
/** The stage the strip marks as current. */
const current = () => document.querySelector('[aria-current="step"]')?.textContent ?? '';

async function personal() {
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Demo Person' } });
  await choose('Account role', 'Front desk / clinical staff');
}

beforeEach(() => {
  // The one intake call answers for the whole hire: clean, written, and who they now are.
  post.mockReset().mockResolvedValue({
    dryRun: false,
    rowCount: 1,
    clean: true,
    created: 1,
    results: [{ index: 0, problems: [], readiness: { blocking: [], advisory: [] }, staffId: 'staff-new' }],
  });
  patch.mockReset().mockResolvedValue({});
});

/** antd's DatePicker takes a typed date and Enter. */
function typeDate(label: string, text: string) {
  const box = screen.getByLabelText(label);
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' });
}

describe('the identity document', () => {
  it('refuses an IC that is not the Malaysian shape, on the stage that has the box', async () => {
    open();
    await personal();
    fireEvent.change(screen.getByLabelText('IC number'), { target: { value: '9001011455' } });
    fireEvent.click(continueButton());
    expect(await screen.findByText(/A Malaysian IC is 12 digits/)).toBeInTheDocument();
    expect(current()).toContain('Personal');
    // A real one goes through.
    fireEvent.change(screen.getByLabelText('IC number'), { target: { value: '900101-14-5567' } });
    fireEvent.click(continueButton());
    await waitFor(() => expect(current()).toContain('Employment'));
  });

  it('asks for a passport number instead, with no IC rule, when the document is a passport', async () => {
    open();
    await personal();
    await choose('Document', 'Passport');
    expect(screen.queryByLabelText('IC number')).toBeNull();
    fireEvent.change(screen.getByLabelText('Passport number'), { target: { value: 'A12345678' } });
    fireEvent.click(continueButton());
    await waitFor(() => expect(current()).toContain('Employment'));
    expect(screen.queryByText(/A Malaysian IC is 12 digits/)).toBeNull();
  });
});

describe('the emergency contact', () => {
  it('offers the usual relationships, and still takes a typed one', async () => {
    open();
    const box = screen.getByLabelText('Relationship');
    fireEvent.mouseDown(box);
    for (const option of ['Spouse', 'Parent', 'Child', 'Sibling', 'Relative', 'Friend', 'Housemate']) {
      expect(await screen.findByTitle(option)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTitle('Spouse'));
    await act(async () => {});
    expect(box).toHaveValue('Spouse');
    // Still a box: what nobody listed is simply typed.
    fireEvent.change(box, { target: { value: 'Neighbour' } });
    await act(async () => {});
    expect(box).toHaveValue('Neighbour');
  });
});

describe('nationality', () => {
  it('records a Malaysian citizen as Malaysian without asking, and asks anybody else', async () => {
    open();
    await personal();
    fireEvent.click(continueButton());
    await waitFor(() => expect(current()).toContain('Employment'));
    fireEvent.click(continueButton());
    await waitFor(() => expect(current()).toContain('Pay & Statutory'));
    expect(screen.queryByLabelText('Nationality')).toBeNull();

    await choose('EPF membership', 'Non-citizen');
    expect(screen.getByLabelText('Nationality')).toBeVisible();
    fireEvent.click(continueButton());
    expect(await screen.findByText('Which country are they a citizen of?')).toBeInTheDocument();
    expect(current()).toContain('Pay & Statutory');

    await choose('EPF membership', 'Malaysian citizen');
    expect(screen.queryByLabelText('Nationality')).toBeNull();
    fireEvent.click(continueButton());
    await waitFor(() => expect(current()).toContain('Review'));
    fireEvent.click(screen.getByRole('button', { name: 'Add employee' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toBe('/workforce/employees/intake');
    expect(post.mock.calls[0][1]).toMatchObject({ rows: [{ fullName: 'Demo Person', nationality: 'Malaysian' }], commit: true });
  });
});

describe('what payroll blocks on', () => {
  it('asks for the employing company, the rest day and LINDUNG, records them at hire, and dates the standing from the start date', async () => {
    open();
    await personal();
    fireEvent.click(continueButton());
    await waitFor(() => expect(current()).toContain('Employment'));
    typeDate('Started on', '1 Jan 2026');
    fireEvent.click(continueButton());
    await waitFor(() => expect(current()).toContain('Pay & Statutory'));
    // One company on file: chosen for them. The rest day and the membership are theirs to say.
    await choose('Rest day', 'Sunday');
    await choose('EPF membership', 'Malaysian citizen');
    fireEvent.click(continueButton());
    await waitFor(() => expect(current()).toContain('Review'));
    expect(screen.queryByText(/No employing company/)).toBeNull();
    expect(screen.queryByText(/No rest day/)).toBeNull();
    expect(screen.queryByText(/No EPF membership/)).toBeNull();
    // Still missing, and said: the salary, the tax profile and the bank account.
    expect(screen.getByText(/No salary in force/)).toBeVisible();
    expect(screen.getByText(/No tax residence or MTD category/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Add employee' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    // One row, one call: the company and the standing travel with the person, dated from the start date.
    expect(post.mock.calls[0][0]).toBe('/workforce/employees/intake');
    expect(post.mock.calls[0][1]).toMatchObject({
      rows: [{ legalEmployerId: 'emp-1', standing: { effectiveFrom: '2026-01-01', epfMembership: 'MALAYSIAN_CITIZEN', restDayOfWeek: 0, lindungParticipation: 'ENROLLED' } }],
      commit: true,
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it('names the employing company and the rest day as missing before the record is made', async () => {
    open();
    await personal();
    fireEvent.click(continueButton());
    await waitFor(() => expect(current()).toContain('Employment'));
    fireEvent.click(continueButton());
    await waitFor(() => expect(current()).toContain('Pay & Statutory'));
    fireEvent.click(continueButton());
    await waitFor(() => expect(current()).toContain('Review'));
    expect(screen.getByText(/No rest day — payroll refuses the month/)).toBeVisible();
    expect(screen.getByText(/No EPF membership/)).toBeVisible();
  });
});

describe('the stage strip', () => {
  it('reopens a stage already visited from the strip, and does not offer one not yet reached', async () => {
    open();
    await personal();
    fireEvent.click(continueButton());
    await waitFor(() => expect(current()).toContain('Employment'));
    expect(screen.getByRole('button', { name: /Personal/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pay & Statutory/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Personal/ }));
    await waitFor(() => expect(current()).toContain('Personal'));
    // The stage it came back from was reached, so it is still a tap away.
    fireEvent.click(screen.getByRole('button', { name: /Employment/ }));
    await waitFor(() => expect(current()).toContain('Employment'));
  });
});

/*
 * THE IC SAYS WHEN THEY WERE BORN AND WHICH THEY ARE. YYMMDD is the birth date
 * and the last digit is odd for a man, even for a woman, so a valid IC fills
 * both — into boxes that are still boxes.
 */
describe('what the IC already says', () => {
  it('fills the date of birth and the gender from a valid IC, and keeps a typed answer', async () => {
    open();
    fireEvent.change(screen.getByLabelText('IC number'), { target: { value: '900101-14-5567' } });
    await waitFor(() => expect((screen.getByLabelText('Date of birth') as HTMLInputElement).value).toBe('1 Jan 1990'));
    // 7 is odd: male. The combobox shows the chosen label.
    await waitFor(() => expect(screen.getByLabelText('Gender').closest('.ant-select')?.textContent).toContain('Male'));
    // Typed over, the typed answer stays when the IC changes.
    await choose('Gender', 'Female');
    fireEvent.change(screen.getByLabelText('IC number'), { target: { value: '850505-10-5571' } });
    await waitFor(() => expect((screen.getByLabelText('Date of birth') as HTMLInputElement).value).toBe('5 May 1985'));
    expect(screen.getByLabelText('Gender').closest('.ant-select')?.textContent).toContain('Female');
  });

  it('leaves both alone for a passport, which says neither', async () => {
    open();
    await choose('Document', 'Passport');
    fireEvent.change(screen.getByLabelText('Passport number'), { target: { value: '900101145567' } });
    await act(async () => {});
    expect((screen.getByLabelText('Date of birth') as HTMLInputElement).value).toBe('');
  });
});

/*
 * THE RECORD SET: a rest day that varies is an answer, the address goes in
 * parts, and the days a week are recorded rather than derived.
 */
describe('the employee record set', () => {
  it('records a rest day that varies as an answer, and sends the address in parts', async () => {
    open();
    await personal();
    fireEvent.change(screen.getByLabelText('Street address'), { target: { value: '12, Jalan Bangi Avenue 3' } });
    fireEvent.change(screen.getByLabelText('Postcode'), { target: { value: '43650' } });
    fireEvent.change(screen.getByLabelText('City or town'), { target: { value: 'Bandar Baru Bangi' } });
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'Selangor' } });
    fireEvent.click(await screen.findByTitle('Selangor'));
    await act(async () => {});
    fireEvent.click(continueButton());
    await waitFor(() => expect(current()).toContain('Employment'));
    typeDate('Started on', '1 Jan 2026');
    await choose('Days a week', '5½ days');
    fireEvent.click(continueButton());
    await waitFor(() => expect(current()).toContain('Pay & Statutory'));
    await choose('Rest day', 'Varies week to week');
    fireEvent.click(continueButton());
    await waitFor(() => expect(current()).toContain('Review'));
    // Varies is an answer: the review no longer says the rest day is missing.
    expect(screen.queryByText(/No rest day/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add employee' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const created = post.mock.calls.find((call) => call[0] === '/workforce/employees/intake')!;
    expect(created[1]).toMatchObject({
      rows: [
        {
          address: '12, Jalan Bangi Avenue 3',
          postcode: '43650',
          city: 'Bandar Baru Bangi',
          state: 'Selangor',
          workDaysPerWeek: 5.5,
          standing: { restDayOfWeek: null, restDayVaries: true },
        },
      ],
    });
  });
});
