// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PatientAllergyStrip } from './AllergyStrip';
import { AllergyQuickRecord } from '../canvas/AllergyQuickRecord';
import { Patient } from '../../core/types';

// ===========================================================================
// b1.5 FIX 3 — THE SPLIT, ON THE SURFACES A DOCTOR ACTUALLY READS.
//
// Phase D found FIVE surfaces reading allergy state and fixed four by
// reasoning; the fifth was caught only because an E2E asserted the rendered
// consequence. So this file asserts the consequence too: what the chip SAYS
// and what the banner SAYS, given a patient who has both kinds of alert.
//
// The staging case exactly: three drug allergies, two chronic conditions and
// one access need, which used to render as one red line.
// ===========================================================================

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn(), postFile: vi.fn() },
  downloadFile: vi.fn(),
  fetchBlobUrl: vi.fn(),
}));

const base = { patientId: 'p1', note: null, active: true, createdAt: '2026-08-01T00:00:00Z', createdByStaffId: 's1', createdByName: 'Dr A', deactivatedAt: null, deactivatedByName: null };
const ALERTS = [
  { ...base, id: 'a1', type: 'ALLERGY', label: 'AUGMENTIN' },
  { ...base, id: 'a2', type: 'MEDICAL', label: 'DM' },
  { ...base, id: 'a3', type: 'MEDICAL', label: 'HPT' },
  { ...base, id: 'a4', type: 'ACCESSIBILITY', label: 'OKU' },
];

const PATIENT = { id: 'p1', name: 'Ujian', allergies: ['NSAIDS', 'PCM'] } as unknown as Patient;

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (url: string) => (String(url).includes('/alerts') ? ALERTS : []));
});

describe('the prescribing banner', () => {
  it('warns on the allergies, and on nothing else', async () => {
    render(
      <Harness>
        <PatientAllergyStrip allergies={PATIENT.allergies} patientId="p1" />
      </Harness>,
    );
    // Awaited: the ALLERGY alerts arrive with a request, while the patient's
    // own allergies render immediately from props. Asserting too early would
    // pass for the wrong reason.
    await screen.findByText(/AUGMENTIN/);
    const strip = document.querySelector('[data-allergy-strip]') as HTMLElement;
    expect(strip.textContent).toContain('NSAIDS');
    expect(strip.textContent).toContain('PCM');
    expect(strip.textContent).toContain('AUGMENTIN');
    // The three that are NOT do-not-prescribe instructions.
    expect(strip.textContent).not.toContain('DM');
    expect(strip.textContent).not.toContain('HPT');
    expect(strip.textContent).not.toContain('OKU');
  });

  it('still SHOWS the chronic conditions — they stop masquerading, they do not vanish', async () => {
    // "Other alerts must not silently disappear from view." A doctor who could
    // previously see DM on the banner must still see it somewhere.
    render(
      <Harness>
        <PatientAllergyStrip allergies={PATIENT.allergies} patientId="p1" />
      </Harness>,
    );
    const others = await screen.findByText(/Also on record:/);
    expect(others.textContent).toContain('DM');
    expect(others.textContent).toContain('HPT');
    expect(others.textContent).toContain('OKU');
  });

  it('renders no other-alerts line when there are none', async () => {
    get.mockImplementation(async () => []);
    render(
      <Harness>
        <PatientAllergyStrip allergies={['NSAIDS']} patientId="p1" />
      </Harness>,
    );
    await screen.findByText(/NSAIDS/);
    expect(screen.queryByText(/Also on record:/)).toBeNull();
  });
});

describe('the header allergy chip', () => {
  it('lists the allergies only', async () => {
    render(
      <Harness>
        <AllergyQuickRecord patient={PATIENT} />
      </Harness>,
    );
    await screen.findByText(/AUGMENTIN/);
    const chip = screen.getByRole('button', { name: /^Allergies:/ });
    expect(chip.textContent).toContain('NSAIDS');
    expect(chip.textContent).toContain('AUGMENTIN');
    expect(chip.textContent).not.toContain('DM');
    expect(chip.textContent).not.toContain('OKU');
  });

  it('reads "not asked" for a patient with only chronic conditions', async () => {
    // Diabetes on record is not an answer to "any allergies?".
    get.mockImplementation(async (url: string) =>
      String(url).includes('/alerts') ? [{ ...base, id: 'a2', type: 'MEDICAL', label: 'DM' }] : [],
    );
    render(
      <Harness>
        <AllergyQuickRecord patient={{ ...PATIENT, allergies: null } as Patient} />
      </Harness>,
    );
    expect(await screen.findByRole('button', { name: /Allergy not asked/i })).toBeInTheDocument();
  });
});
