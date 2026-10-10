// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  gridColumn: false,
  carryForward: false,
  payDay: 30,
  payMonthOffset: 0,
  appliesTo: 'EVERYONE',
  appliesToStaffIds: [],
  appliesToStaff: [],
  audienceEditable: true,
  handKeyed: true,
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
  // A clinic whose catalogue is up to date, which is the ordinary case.
  missingPresets: [],
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
const setPayDateMutate = vi.fn();

/** What `usePayComponents` returns for the test currently running. */
let served: PayComponentList = list;

const employees = [
  { staffId: 's-doctor', fullName: 'Dr Demo Doktor', position: 'Medical officer', active: true },
  { staffId: 's-nurse', fullName: 'Demo Jururawat', position: 'Staff nurse', active: true },
];

vi.mock('../hooks/useAdmin', () => ({
  useEmployees: () => ({ data: employees, isLoading: false }),
  usePayComponents: () => ({ data: served, isLoading: false, error: null }),
  usePayComponentHistory: (code: string | null) => ({ data: code ? history : undefined, isLoading: false }),
  useSeedPayComponents: () => ({ mutate: vi.fn(), isPending: false }),
  useUpsertPayComponent: () => ({ mutate: upsertMutate, isPending: false }),
  useSetPayDate: () => ({ mutate: setPayDateMutate, isPending: false }),
}));
vi.mock('../../core/hooks/useCan', () => ({ useCan: () => true }));

const { PayrollItemsPage } = await import('./PayrollItemsPage');

const mount = (data: PayComponentList = list) => {
  served = data;
  return render(
    <AntApp>
      <MemoryRouter>
        <PayrollItemsPage />
      </MemoryRouter>
    </AntApp>,
  );
};

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

  /*
   * A COMPONENT KUWICK ADDS LATER HAS TO BE REACHABLE.
   *
   * The seed is additive — it creates a code that is absent and skips one that
   * is present — but its button was drawn only when the catalogue was EMPTY.
   * So a clinic that seeded on day one could never receive anything added
   * afterwards: the component would exist in the product, be missing from this
   * screen, and the payroll run that told them to use it would name something
   * they could not find. That is how the untaken-leave payout would have
   * shipped broken for every existing clinic.
   */
  describe('standard items added after this clinic seeded', () => {
    it('offers nothing when the catalogue is already complete', () => {
      mount(list);
      expect(screen.queryByRole('button', { name: /^Add .*standard item/ })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Seed the catalogue' })).toBeNull();
    });

    it('names the one item it would add, rather than counting it', () => {
      mount({ ...list, missingPresets: [{ code: 'LEAVE_PAYOUT', name: 'Untaken annual leave paid out' }] });
      expect(screen.getByRole('button', { name: 'Add Untaken annual leave paid out' })).toBeTruthy();
    });

    it('counts them once there is more than one', () => {
      mount({
        ...list,
        missingPresets: [
          { code: 'LEAVE_PAYOUT', name: 'Untaken annual leave paid out' },
          { code: 'SOMETHING_ELSE', name: 'Something else' },
        ],
      });
      expect(screen.getByRole('button', { name: 'Add 2 standard items' })).toBeTruthy();
    });

    it('still offers the first seed on an empty catalogue', () => {
      mount({ ...list, components: [] });
      expect(screen.getByRole('button', { name: 'Seed the catalogue' })).toBeTruthy();
    });
  });
});

/*
 * MOVING A PLAN'S DATE WITHOUT PRETENDING TO CHANGE A FLAG.
 *
 * The account holder's Allowance had the four switches he wanted and the wrong
 * month — a version dated from October when August needed covering. The only
 * route through was to save a flag at a value he did not want and then correct
 * it: two versions, and an audit log recording a decision nobody made, to move
 * one date.
 */
describe('a version that has not started', () => {
  it('offers its date for correction on its own', () => {
    mount();
    // MILEAGE is the clinic-overridden row; BONUS is the one dated 2099.
    expect(screen.getAllByRole('button', { name: /Change the month/i }).length).toBeGreaterThan(0);
  });

  it('sends the same treatment with a new date, and no invented flag', async () => {
    mount();
    upsertMutate.mockClear();
    fireEvent.click(screen.getAllByRole('button', { name: /Change the month/i })[0]);
    fireEvent.change(screen.getByLabelText(/Why/i), { target: { value: 'The month was wrong.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(upsertMutate).toHaveBeenCalled());
    const sent = upsertMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sent.reason).toBe('The month was wrong.');
    // No key called "null", and nothing claiming a switch moved.
    expect(Object.keys(sent)).not.toContain('null');
  });

  it('will not save the move without a reason, because it is kept with the version', async () => {
    mount();
    upsertMutate.mockClear();
    fireEvent.click(screen.getAllByRole('button', { name: /Change the month/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText(/Say why/i)).toBeTruthy());
    expect(upsertMutate).not.toHaveBeenCalled();
  });
});

/*
 * HOW AN ITEM SITS ON THE PAYROLL GRID is layout, not treatment: the two
 * switches save in place, with no date and no reason, and are offered only
 * on an item a person keys.
 */
describe('how an item sits on the payroll grid', () => {
  it('switches own column and carry forward in place, with no date and no reason', () => {
    upsertMutate.mockReset();
    mount();
    fireEvent.click(screen.getByLabelText('Own column for Allowance'));
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    const body = upsertMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'ALLOWANCE', gridColumn: true, carryForward: false, active: true });
    expect(body.effectiveFrom).toBeUndefined();
    expect(body.reason).toBeUndefined();
    expect(screen.queryByRole('dialog', { name: /take effect/i })).toBeNull();

    fireEvent.click(screen.getByLabelText('Carry forward for Allowance'));
    expect(upsertMutate.mock.calls[1][0]).toMatchObject({ code: 'ALLOWANCE', carryForward: true });
  });

  it('offers neither switch on an item the run derives', () => {
    mount({
      ...list,
      components: [...list.components, component({ id: 'c-ot', code: 'OVERTIME', name: 'Overtime', type: 'OVERTIME', category: 'REMUNERATION', handKeyed: false })],
    });
    expect(screen.queryByLabelText('Own column for Overtime')).toBeNull();
    expect(screen.queryByLabelText('Carry forward for Overtime')).toBeNull();
    expect(screen.getByLabelText('Own column for Allowance')).toBeTruthy();
  });
});

/*
 * WHO AN ITEM IS FOR. An item with a column of its own gave that column to
 * every employee; now it names its people, and the save is in place like the
 * layout switches: no date, no reason, the whole row sent back with the list.
 */
describe('who an item is for', () => {
  it('names the employees an item is for, and saves the list in place', () => {
    upsertMutate.mockReset();
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Who Allowance is for' }));
    expect(screen.getByRole('dialog', { name: 'Who Allowance is for' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Selected employees only'));
    fireEvent.click(screen.getByLabelText(/Dr Demo Doktor/));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    const body = upsertMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'ALLOWANCE', appliesTo: 'SELECTED', appliesToStaffIds: ['s-doctor'] });
    expect(body.effectiveFrom).toBeUndefined();
    expect(body.reason).toBeUndefined();
  });

  it('refuses an empty list, and shows who is named on the row', () => {
    upsertMutate.mockReset();
    mount({
      ...list,
      components: [component({ appliesTo: 'SELECTED', appliesToStaffIds: ['s-doctor'], appliesToStaff: [{ staffId: 's-doctor', fullName: 'Dr Demo Doktor', active: true }] })],
    });
    const button = screen.getByRole('button', { name: 'Who Allowance is for' });
    expect(button).toHaveTextContent('1 employee');
    fireEvent.click(button);
    // Untick the one person: the drawer refuses rather than saving nobody.
    fireEvent.click(screen.getByLabelText(/Dr Demo Doktor/));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(upsertMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/Pick at least one employee Allowance is for/)).toBeTruthy();
  });

  it('is not offered on an item the run derives', () => {
    mount({
      ...list,
      components: [component({ id: 'c-ot', code: 'OVERTIME', name: 'Overtime', type: 'OVERTIME', category: 'REMUNERATION', handKeyed: false, audienceEditable: false })],
    });
    expect(screen.queryByRole('button', { name: 'Who Overtime is for' })).toBeNull();
  });
});

/*
 * WHEN AN ITEM IS PAID (UAT, 10 October 2026): one payroll month is paid on
 * three dates, set per item. Payment, not treatment, so it saves at once
 * with no date and no reason.
 */
describe('when an item is paid', () => {
  it('shows each item’s pay date and moves one with a quick pick', () => {
    setPayDateMutate.mockReset();
    mount({
      ...list,
      components: [
        component(),
        component({ id: 'c-ot', code: 'OVERTIME', name: 'Overtime', type: 'OVERTIME', category: 'REMUNERATION', payDay: 15, payMonthOffset: 1 }),
      ],
    });
    expect(screen.getByRole('button', { name: 'When Allowance is paid: 30th' })).toHaveTextContent('30th');
    expect(screen.getByRole('button', { name: 'When Overtime is paid: 15th, next month' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'When Allowance is paid: 30th' }));
    const popover = screen.getByRole('dialog', { name: 'When Allowance is paid' });
    fireEvent.click(within(popover).getByRole('button', { name: '1st, next month' }));
    expect(setPayDateMutate).toHaveBeenCalledTimes(1);
    expect(setPayDateMutate.mock.calls[0][0]).toEqual({ code: 'ALLOWANCE', payDay: 1, payMonthOffset: 1 });
  });

  it('takes any other day, and says a deduction comes out of the salary payment', () => {
    setPayDateMutate.mockReset();
    mount({
      ...list,
      components: [
        component(),
        component({ id: 'c-uniform', code: 'UNIFORM', name: 'Uniform deduction', type: 'DEDUCTION', category: 'PAYROLL_DEDUCTION', includeIn: 'NET_ONLY' }),
      ],
    });
    expect(screen.getByText('From the salary payment')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /When Uniform deduction is paid/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'When Allowance is paid: 30th' }));
    const popover = screen.getByRole('dialog', { name: 'When Allowance is paid' });
    fireEvent.change(within(popover).getByLabelText('Day of the month'), { target: { value: '25' } });
    fireEvent.click(within(popover).getByRole('button', { name: 'Save' }));
    expect(setPayDateMutate.mock.calls[0][0]).toEqual({ code: 'ALLOWANCE', payDay: 25, payMonthOffset: 0 });
  });
});
