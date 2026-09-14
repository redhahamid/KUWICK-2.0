// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PayComponentHistory, PayComponentList, PayComponentRow } from '../types';

/*
 * PAYROLL ITEMS — after the September UAT finding that the statutory treatment
 * was "locked but unverified".
 *
 * Kuwick seeds a catalogue reproducing what the old engine did and used to
 * freeze it. Whether an allowance attracts EPF is not a fact about Malaysia
 * that a product can ship: it is a POLICY the clinic sets within what the law
 * permits, and clinics differ. So the switches are live — but a change is
 * dated, reasoned, and marked as the clinic's own.
 */
const component = (over: Partial<PayComponentRow> = {}): PayComponentRow => ({
  id: 'c-allowance',
  code: 'ALLOWANCE',
  name: 'Allowance',
  updatedAt: '2026-09-01T00:00:00.000Z',
  type: 'ADDITION',
  category: 'ALLOWANCE',
  includeIn: 'GROSS_AND_NET',
  pcbLiable: true,
  epfLiable: true,
  socsoLiable: true,
  eisLiable: true,
  hrdLiable: false,
  includeInOrpBase: false,
  includeInUnpaidLeaveBase: false,
  additionalRemuneration: false,
  pcbExemptionLimitCents: null,
  eaField: null,
  prorated: false,
  employerSide: false,
  systemControlled: true,
  active: true,
  verificationStatus: 'DRAFT',
  version: 1,
  effectiveFrom: '1970-01-01',
  effectiveTo: null,
  clinicOverride: false,
  changeReason: null,
  ...over,
});

const list: PayComponentList = {
  components: [
    component(),
    component({
      id: 'c-mileage',
      code: 'MILEAGE',
      name: 'Mileage / travelling allowance',
      epfLiable: false,
      socsoLiable: false,
      eisLiable: false,
      pcbLiable: false,
      version: 2,
      // In the past: this version is in force, so changing it means a new one.
      effectiveFrom: '2026-08-01',
      clinicOverride: true,
      changeReason: 'Reimbursement of travel actually incurred.',
    }),
    component({
      id: 'c-bonus',
      code: 'BONUS',
      name: 'Bonus',
      version: 2,
      // Well ahead of any date a test runs on: a PLAN, not a record.
      effectiveFrom: '2099-01-01',
      clinicOverride: true,
      changeReason: 'Mis-tap, waiting to be corrected.',
    }),
  ],
  verificationNotice: {
    anyVerified: false,
    statement:
      'No statutory treatment on this page has been checked against KWSP, PERKESO, LHDN or HRD Corp. ' +
      'These flags reproduce what the payroll engine already did; they are not a statement of Malaysian law.',
  },
};

const history: PayComponentHistory = {
  code: 'MILEAGE',
  name: 'Mileage / travelling allowance',
  versions: [
    {
      id: 'v2',
      version: 2,
      effectiveFrom: '2026-10-01',
      effectiveTo: null,
      pcbLiable: false,
      epfLiable: false,
      socsoLiable: false,
      eisLiable: false,
      hrdLiable: false,
      includeInOrpBase: false,
      includeInUnpaidLeaveBase: false,
      additionalRemuneration: false,
      prorated: false,
      clinicOverride: true,
      changeReason: 'Reimbursement of travel actually incurred.',
      sourceRef: null,
      verificationStatus: 'DRAFT',
      setBy: 'Dr Aisyah Rahman',
      setAt: '2026-09-13T02:00:00.000Z',
    },
    {
      id: 'v1',
      version: 1,
      effectiveFrom: '1970-01-01',
      effectiveTo: '2026-09-30',
      pcbLiable: true,
      epfLiable: false,
      socsoLiable: false,
      eisLiable: false,
      hrdLiable: false,
      includeInOrpBase: false,
      includeInUnpaidLeaveBase: false,
      additionalRemuneration: false,
      prorated: false,
      clinicOverride: false,
      changeReason: null,
      sourceRef: 'Seeded to reproduce the existing engine behaviour. Not verified against any authority.',
      verificationStatus: 'DRAFT',
      setBy: null,
      setAt: '2026-08-01T00:00:00.000Z',
    },
  ],
};

const upsertMutate = vi.fn();

vi.mock('../hooks/useAdmin', () => ({
  usePayComponents: () => ({ data: list, isLoading: false, error: null }),
  usePayComponentHistory: (code: string | null) => ({ data: code ? history : undefined, isLoading: false }),
  useSeedPayComponents: () => ({ mutate: vi.fn(), isPending: false }),
  useUpsertPayComponent: () => ({ mutate: upsertMutate, isPending: false }),
}));
vi.mock('../../core/hooks/useCan', () => ({ useCan: () => true }));

const { PayrollItemsPage } = await import('./PayrollItemsPage');

const mount = () =>
  render(
    <AntApp>
      <MemoryRouter>
        <PayrollItemsPage />
      </MemoryRouter>
    </AntApp>,
  );

describe('the statutory treatment of a payroll item', () => {
  it('is editable on a SYSTEM item, which it was not before', () => {
    mount();
    // ALLOWANCE is systemControlled. Its EPF switch used to be drawn disabled
    // with "A system item keeps its statutory treatment"; a real clinic needs
    // exactly this switch, because it contributes EPF on basic pay only.
    const epf = screen.getByLabelText('EPF for Allowance');
    expect(epf).not.toBeDisabled();
  });

  it('still refuses to be changed without a date and a reason', () => {
    mount();
    fireEvent.click(screen.getByLabelText('EPF for Allowance'));

    // The switch does not save on its own: it opens the question of when, and why.
    expect(upsertMutate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /take effect/i })).toBeTruthy();
    expect(screen.getByText(/months already priced keep the old one/i)).toBeTruthy();
  });

  it('says whose decision a changed row was, and why, on the row', () => {
    mount();
    // Not in an audit log: on the screen, next to the figure it explains.
    // Two rows carry it now — the one in force and the one still a plan.
    expect(screen.getAllByText('Your clinic')).toHaveLength(2);
    expect(screen.getByText('Reimbursement of travel actually incurred.')).toBeTruthy();
    expect(screen.getByText(/from 1 Aug 2026/)).toBeTruthy();
  });

  it('never claims any of it has been checked against an authority', () => {
    mount();
    expect(screen.getByText(/not a statement of Malaysian law/i)).toBeTruthy();
    expect(screen.getByText('Unchecked')).toBeTruthy();
  });
});

describe('the reason, which stays mandatory but need not be typed', () => {
  it('offers the reasons a clinic actually gives', () => {
    mount();
    fireEvent.click(screen.getByLabelText('EPF for Allowance'));
    // Mandatory, and the owner agreed it should stay mandatory — but typing one
    // on a phone every time a switch is touched is a tax on doing the right
    // thing.
    expect(screen.getByLabelText('Common reasons')).toBeTruthy();
  });

  it('keeps the free-text box, because a picked sentence is a starting point', () => {
    mount();
    fireEvent.click(screen.getByLabelText('EPF for Allowance'));
    const box = screen.getByLabelText('Why') as HTMLInputElement;
    expect(box).toBeTruthy();
    fireEvent.change(box, { target: { value: 'KWSP circular of 12 Aug.' } });
    expect(box.value).toBe('KWSP circular of 12 Aug.');
  });

  it('will not save with the reason left empty', () => {
    mount();
    fireEvent.click(screen.getByLabelText('EPF for Allowance'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(upsertMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/Say why/)).toBeTruthy();
  });
});

describe('a version that has not started yet', () => {
  it('says it will be REPLACED, not stacked on', () => {
    mount();
    fireEvent.click(screen.getByLabelText('EPF for Bonus'));
    // The owner mis-tapped, saved from a future date, and could not undo it.
    // The screen must not keep calling that "a new version".
    expect(screen.getByText(/has not started yet, so editing it replaces it/)).toBeTruthy();
  });

  it('still calls a change to a version in force a new version', () => {
    mount();
    fireEvent.click(screen.getByLabelText('EPF for Mileage / travelling allowance'));
    expect(screen.getByText(/months already priced keep the old one/)).toBeTruthy();
  });
});

describe('the history of one item', () => {
  it('shows each version with its dates and what it changed', async () => {
    mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'History' })[1]);

    await waitFor(() => expect(screen.getByText(/every version/)).toBeTruthy());
    expect(screen.getByText(/1 Oct 2026 onwards/)).toBeTruthy();
    expect(screen.getByText(/1 Jan 1970 – 30 Sep 2026/)).toBeTruthy();
    // v2 turned PCB off; that is the one line worth reading twice.
    expect(screen.getByText(/Changed: PCB off/)).toBeTruthy();
  });

  it('keeps Kuwick’s guess and the clinic’s decision apart', async () => {
    mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'History' })[1]);

    await waitFor(() => expect(screen.getByText(/every version/)).toBeTruthy());
    // The version the clinic chose names the person who chose it.
    expect(screen.getByText(/Set by Dr Aisyah Rahman/)).toBeTruthy();
    // The seeded one still says it is Kuwick's, unchecked.
    expect(screen.getByText(/Seeded to reproduce the existing engine behaviour/)).toBeTruthy();
  });
});

describe('a component the clinic makes itself', () => {
  it('starts liable to nothing it has not been told about, except tax', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add an item' }));

    await waitFor(() => expect(screen.getByText('Add a payroll item')).toBeTruthy());
    // Pay is taxable unless something says otherwise; everything else is the
    // clinic's to say, and a form that pre-ticked EPF would be Kuwick guessing
    // at a policy and calling it a default.
    expect(screen.getByLabelText('PCB')).toBeChecked();
    expect(screen.getByLabelText('EPF')).not.toBeChecked();
    expect(screen.getByLabelText('SOCSO')).not.toBeChecked();
    expect(screen.getByLabelText('EIS')).not.toBeChecked();
  });

  it('refuses a second item with a code that is already taken', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add an item' }));
    await waitFor(() => expect(screen.getByText('Add a payroll item')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('What is it called'), { target: { value: 'Another allowance' } });
    fireEvent.change(screen.getByLabelText('Short code'), { target: { value: 'allowance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }));

    expect(upsertMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/already exists/)).toBeTruthy();
  });
});
