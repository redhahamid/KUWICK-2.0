// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PatientProfileSlideOver } from './PatientProfileSlideOver';
import { describeIdentityImpact, mayCorrectPatientIdentity } from '../core/patient-identity-access';
import { Patient } from '../core/types';

// ===========================================================================
// CORRECTING AN IC IS SAFER THAN NOT BEING ABLE TO.
//
// The fields were locked, which read as caution and worked as the opposite: a
// transposed digit taken at registration could not be fixed, so the counter
// opened a SECOND patient and one person's visits, invoices and claims split
// across two files. Staging holds an 11-digit IC and a date of birth of
// 05/05/2026 that nobody can correct.
//
// It then shipped restricted to owner and front counter, which was the same
// mistake one step smaller, and the owner removed it: in a small clinic whoever
// is holding the IC card is who needs to fix it, and sending them to find
// another account is how the second file gets created anyway.
//
// So what makes it safe is what these hold, and none of it is the grant list: a
// confirmation that NAMES what is attached, the server's refusal when the
// identifier is already somebody else's, and the fact that a phone-number save
// triggers none of it.
// ===========================================================================

const { get, patch } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, patch, post: vi.fn(), delete: vi.fn(), put: vi.fn(), postFile: vi.fn() },
  downloadFile: vi.fn(),
  fetchBlobUrl: vi.fn(),
}));

const PATIENT: Patient = {
  id: 'patient-1',
  tenantId: 't',
  identifierType: 'NRIC',
  identifierValue: '12345678901',
  name: 'Aisyah Ujian',
  dob: '2026-05-05',
  gender: 'FEMALE',
  race: null,
  phone: '0123456789',
  address: 'Jalan Satu',
  emergencyContactName: 'Ahmad',
  emergencyContactPhone: '0198887777',
};

let IMPACT = { visits: 0, invoices: 0, documents: 0 };

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  IMPACT = { visits: 0, invoices: 0, documents: 0 };
  get.mockImplementation(async (url: string) =>
    String(url).includes('/identity-impact') ? IMPACT : [],
  );
  patch.mockResolvedValue({ ...PATIENT });
});

// `Modal.confirm` renders into antd's own module-level root, which
// testing-library's cleanup never unmounts — leave one open and the NEXT test
// finds two "Change it" buttons and a stale impact sentence.
afterEach(() => {
  Modal.destroyAll();
});

const open = (props: Partial<Parameters<typeof PatientProfileSlideOver>[0]> = {}) =>
  render(
    <Harness>
      <PatientProfileSlideOver open patient={PATIENT} onClose={vi.fn()} {...props} />
    </Harness>,
  );

describe('who is offered the fields', () => {
  it('EVERY staff role that sees patients may correct an identity', () => {
    // The whole point of the owner's change: whoever is at the counter with the
    // IC card in hand fixes the typo, rather than going to find an account that
    // can — which is how the second patient record gets created.
    expect(mayCorrectPatientIdentity({ permissions: ['patient.identity.write'] })).toBe(true);
    for (const role of ['OWNER_ADMIN', 'FRONT_DESK_CLINICAL_STAFF', 'DOCTOR_RESIDENT', 'DOCTOR_LOCUM']) {
      expect(mayCorrectPatientIdentity({ role })).toBe(true);
    }
  });

  it('a back-office account is not — open to everyone who SEES patients, not everyone', () => {
    // Finance, HR, stock and panel hold no system role at all, so the server
    // would refuse them, and the browser must not offer a control the server
    // refuses.
    expect(mayCorrectPatientIdentity({ permissions: ['billing.counter'] })).toBe(false);
    for (const role of ['FINANCE_STAFF', 'HR_STAFF', 'STOCK_STAFF', 'PANEL_STAFF', 'PATIENT_PORTAL']) {
      expect(mayCorrectPatientIdentity({ role })).toBe(false);
    }
    expect(mayCorrectPatientIdentity(null)).toBe(false);
  });

  it("the server's published permissions win over the legacy role fallback", () => {
    // The fallback exists only for a session minted before permissions were
    // published. Once the server has answered, the browser does not re-derive.
    expect(mayCorrectPatientIdentity({ role: 'DOCTOR_RESIDENT', permissions: [] })).toBe(false);
  });

  it('an account without it sees the field disabled rather than hidden', async () => {
    // Hidden would be worse: somebody who cannot see the field has no way to
    // learn the value is wrong and fixable. There is no explanatory line any
    // more — with every clinical and counter account holding the permission, a
    // sentence about who to ask would be advice almost nobody needs.
    open({ canCorrectIdentity: false });
    expect(await screen.findByDisplayValue('12345678901')).toBeDisabled();
    expect(screen.queryByText(/Only the front counter or the clinic owner/i)).toBeNull();
  });

  it('an account with it can type into the IC field', async () => {
    open({ canCorrectIdentity: true });
    const ic = await screen.findByDisplayValue('12345678901');
    expect(ic).toBeEnabled();
  });
});

describe('the confirmation names what is attached', () => {
  it('lists visits, invoices and documents before the change is made', async () => {
    IMPACT = { visits: 14, invoices: 6, documents: 2 };
    open({ canCorrectIdentity: true });

    const ic = await screen.findByDisplayValue('12345678901');
    await userEvent.clear(ic);
    await userEvent.type(ic, '900101145566');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText(/14 visits, 6 invoices and 2 issued documents/)).toBeInTheDocument();
    // Nothing has been written yet — the question comes first.
    expect(patch).not.toHaveBeenCalled();
  });

  it('says plainly that issued documents are not rewritten', async () => {
    // An MC already handed to an employer is a historical artefact. Somebody
    // approving this change should not have to wonder.
    IMPACT = { visits: 3, invoices: 0, documents: 1 };
    open({ canCorrectIdentity: true });
    const ic = await screen.findByDisplayValue('12345678901');
    await userEvent.clear(ic);
    await userEvent.type(ic, '900101145566');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText(/already-issued documents are not rewritten/i)).toBeInTheDocument();
  });

  it('sends the correction once confirmed', async () => {
    open({ canCorrectIdentity: true });
    const ic = await screen.findByDisplayValue('12345678901');
    await userEvent.clear(ic);
    await userEvent.type(ic, '900101145566');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await userEvent.click(await screen.findByRole('button', { name: /Change it/ }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0][1]).toMatchObject({ identifierValue: '900101145566' });
  });

  it('writes nothing if the confirmation is declined', async () => {
    open({ canCorrectIdentity: true });
    const ic = await screen.findByDisplayValue('12345678901');
    await userEvent.clear(ic);
    await userEvent.type(ic, '900101145566');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await userEvent.click(await screen.findByRole('button', { name: /Keep as it is/ }));
    await waitFor(() => expect(patch).not.toHaveBeenCalled());
  });
});

describe('a phone-number save is untouched by any of this', () => {
  it('does not ask, and does not send the identity fields as a change', async () => {
    // If every save went through the identity path, this fix would have made
    // the ordinary case slower and scarier for no reason.
    open({ canCorrectIdentity: true });
    const phone = await screen.findByDisplayValue('0123456789');
    await userEvent.clear(phone);
    await userEvent.type(phone, '0111111111');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0][1]).toMatchObject({
      phone: '0111111111',
      // Sent, but unchanged — the server compares by value and records nothing.
      identifierValue: '12345678901',
    });
    expect(screen.queryByRole('button', { name: /Change it/ })).toBeNull();
  });
});

describe('the impact sentence', () => {
  it('reads as English for one, two and three kinds of attachment', () => {
    expect(describeIdentityImpact({ visits: 1, invoices: 0, documents: 0 })).toContain('1 visit.');
    expect(describeIdentityImpact({ visits: 2, invoices: 1, documents: 0 })).toContain(
      '2 visits and 1 invoice',
    );
    expect(describeIdentityImpact({ visits: 2, invoices: 1, documents: 3 })).toContain(
      '2 visits, 1 invoice and 3 issued documents',
    );
  });

  it('says so when nothing is attached — that is a different decision', () => {
    expect(describeIdentityImpact({ visits: 0, invoices: 0, documents: 0 })).toMatch(
      /Nothing is attached/i,
    );
  });
});
