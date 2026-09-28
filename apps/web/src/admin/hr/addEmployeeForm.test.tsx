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
  await choose('Job', 'Front desk / clinical staff');
}

beforeEach(() => {
  post.mockReset().mockResolvedValue({ staffId: 'staff-new' });
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
    expect(post.mock.calls[0][0]).toBe('/workforce/employees');
    expect(post.mock.calls[0][1]).toMatchObject({ fullName: 'Demo Person', nationality: 'Malaysian' });
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
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0][0]).toBe('/workforce/employees/staff-new/legal-employer');
    expect(patch.mock.calls[0][1]).toMatchObject({ legalEmployerId: 'emp-1' });
    await waitFor(() => expect(post.mock.calls.some((call) => call[0] === '/workforce/employees/staff-new/statutory-classification')).toBe(true));
    const standing = post.mock.calls.find((call) => call[0] === '/workforce/employees/staff-new/statutory-classification')!;
    expect(standing[1]).toMatchObject({ effectiveFrom: '2026-01-01', epfMembership: 'MALAYSIAN_CITIZEN', restDayOfWeek: 0, lindungParticipation: 'ENROLLED' });
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
