// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PatientProfileSlideOver } from './PatientProfileSlideOver';
import { Patient } from '../core/types';

// ===========================================================================
// b1.5 PHASE D — THE PATIENT BEHIND THE CONSULTATION.
//
// Two things carry clinical weight here and are tested as such: an alert is
// ATTRIBUTED (who recorded it, when) and an alert is never DELETED — resolving
// stamps a second author and leaves the row visible, because "penicillin
// allergy, resolved by Dr X on the 3rd" is the record of a decision.
// ===========================================================================

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, post, patch, delete: vi.fn(), put: vi.fn(), postFile: vi.fn() },
  downloadFile: vi.fn(),
  fetchBlobUrl: vi.fn(),
}));

const PATIENT: Patient = {
  id: 'patient-1',
  tenantId: 't',
  identifierType: 'NRIC',
  identifierValue: '900101-14-5566',
  name: 'Siti Nurhaliza binti Ahmad',
  dob: '1990-01-01',
  gender: 'FEMALE',
  race: null,
  phone: '0123456789',
  address: 'Jalan Satu',
  emergencyContactName: 'Ahmad',
  emergencyContactPhone: '0198887777',
  allergies: null,
};

const PENICILLIN = {
  id: 'alert-1',
  patientId: 'patient-1',
  type: 'MEDICAL',
  label: 'Penicillin allergy',
  note: 'Rash in 2019',
  active: true,
  createdAt: '2026-08-01T02:30:00.000Z',
  createdByStaffId: 'dr-1',
  createdByName: 'Dr Amira Rahman',
  deactivatedAt: null,
  deactivatedByName: null,
};

const RESOLVED = {
  ...PENICILLIN,
  id: 'alert-2',
  label: 'Suspected latex sensitivity',
  note: null,
  active: false,
  deactivatedAt: '2026-08-10T01:00:00.000Z',
  deactivatedByName: 'Dr Lee',
};

let ALERTS: unknown[] = [PENICILLIN, RESOLVED];

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  ALERTS = [PENICILLIN, RESOLVED];
  get.mockImplementation(async (url: string) => (String(url).includes('/alerts') ? ALERTS : []));
  post.mockResolvedValue({ id: 'alert-new' });
  patch.mockResolvedValue({ ...PENICILLIN, active: false });
});

const open = (props: Partial<Parameters<typeof PatientProfileSlideOver>[0]> = {}) =>
  render(
    <Harness>
      <PatientProfileSlideOver open patient={PATIENT} onClose={vi.fn()} {...props} />
    </Harness>,
  );

describe('the profile answers what the identity strip cannot', () => {
  it('shows contact, identity and emergency contact', async () => {
    open();
    expect(await screen.findByDisplayValue('0123456789')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Jalan Satu')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Ahmad')).toBeInTheDocument();
    expect(screen.getByDisplayValue('900101-14-5566')).toBeInTheDocument();
  });

  it('will not let an account without the permission edit the IC', async () => {
    // Offered disabled, never hidden. See patientIdentityCorrection.test.tsx
    // for why the field exists at all: locking it outright is what forced the
    // counter to open a second patient for a transposed digit.
    open();
    expect(await screen.findByDisplayValue('900101-14-5566')).toBeDisabled();
  });

  it('saves an edited phone number', async () => {
    open();
    const phone = await screen.findByDisplayValue('0123456789');
    await userEvent.clear(phone);
    await userEvent.type(phone, '0111111111');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0][0]).toBe('/patients/patient-1');
    expect(patch.mock.calls[0][1]).toMatchObject({ phone: '0111111111' });
  });

  it('offers nothing to save until something changes', async () => {
    open();
    await screen.findByDisplayValue('0123456789');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('a read-only role sees the record and is told why it cannot be changed', async () => {
    // The fields render rather than vanishing: a doctor covering a clinic
    // should see that an emergency contact exists, not an empty space where
    // one might.
    open({ canEdit: false });
    expect(await screen.findByDisplayValue('0123456789')).toBeDisabled();
    expect(screen.getByText(/read this record but not change it/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });
});

describe('alerts are attributed, and never deleted', () => {
  it('names who recorded each alert, and when', async () => {
    // An alert nobody can attribute is one nobody can question.
    open();
    const panel = within(await screen.findByTestId('patient-alerts'));
    // Awaited: the panel itself renders immediately, the rows arrive with the
    // request.
    expect(await panel.findByText('Penicillin allergy')).toBeInTheDocument();
    expect(panel.getByText(/Recorded by Dr Amira Rahman/)).toBeInTheDocument();
    expect(panel.getByText(/01\/08\/2026/)).toBeInTheDocument();
  });

  it('keeps a resolved alert visible, with who resolved it', async () => {
    // Hiding it would leave the profile unable to say why an alert stopped
    // showing on the prescribing banner.
    open();
    const panel = within(await screen.findByTestId('patient-alerts'));
    expect(await panel.findByText('Suspected latex sensitivity')).toBeInTheDocument();
    expect(panel.getByText(/Resolved by Dr Lee/)).toBeInTheDocument();
  });

  it('records a new alert with type, label and note', async () => {
    open();
    await screen.findByTestId('patient-alerts');
    await userEvent.click(screen.getByRole('button', { name: 'Add alert' }));
    await userEvent.type(await screen.findByLabelText('Alert'), 'Type 2 diabetes');
    await userEvent.type(screen.getByLabelText('Note (optional)'), 'Metformin');
    await userEvent.click(screen.getByRole('button', { name: 'Record alert' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toBe('/patients/patient-1/alerts');
    expect(post.mock.calls[0][1]).toMatchObject({
      // FIX 3 — ALLERGY is the default now. It is the consequential one: it
      // reaches the do-not-prescribe chip and the prescribing banner, and a
      // form that defaults to the milder type invites the wrong one.
      type: 'ALLERGY',
      label: 'Type 2 diabetes',
      note: 'Metformin',
    });
    // The author is the SESSION's, resolved server-side. A browser that could
    // post it could attribute a clinical statement to somebody who never made
    // it — and the API rejects the field outright rather than stripping it.
    expect(post.mock.calls[0][1]).not.toHaveProperty('createdByStaffId');
  });

  it('resolving is a PATCH to deactivate — there is no delete anywhere', async () => {
    open();
    const panel = within(await screen.findByTestId('patient-alerts'));
    await userEvent.click(await panel.findByRole('button', { name: 'Resolve' }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0][0]).toBe('/patient-alerts/alert-1/deactivate');
  });

  it('says so plainly when there is nothing on record', async () => {
    ALERTS = [];
    open();
    expect(await screen.findByText(/No active alerts for this patient/i)).toBeInTheDocument();
  });

  it('an account that may not record MEDICAL sees the option disabled, with the reason', async () => {
    // Honest-disabled: removing the option would leave them wondering where
    // allergies are recorded.
    open({ canRecordMedical: false });
    await screen.findByTestId('patient-alerts');
    await userEvent.click(screen.getByRole('button', { name: 'Add alert' }));
    expect(await screen.findByText(/cannot record an Allergy or Medical alert/i)).toBeInTheDocument();
  });
});
