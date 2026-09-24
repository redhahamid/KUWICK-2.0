// @vitest-environment jsdom
import { App as AntApp } from 'antd';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PayrollInputRow } from '../types';

/**
 * THE MONTH'S ITEMS, ONE LINE EACH.
 *
 * The grid's "Other income" cell used to be a text box that folded everything
 * typed into ONE hand-keyed Allowance line. The drawer it opens now keeps
 * each item its own line — overtime, incentives and recurring items read-only
 * with where they came from, hand-keyed lines with add, edit and remove — and
 * works the month out again after every change so the cell and the payslip
 * follow the lines rather than a figure the screen added up.
 */
const upsertMutate = vi.fn();
const removeMutate = vi.fn();
const calculateMutate = vi.fn();
let inputRows: PayrollInputRow[] = [];

function line(over: Partial<PayrollInputRow>): PayrollInputRow {
  return {
    id: 'in-x',
    staffId: 'staff-1',
    staffName: 'Dr Meera Kaur',
    componentCode: 'ALLOWANCE',
    label: null,
    itemName: 'Allowance',
    amount: '0.00',
    kind: 'ADDITIONAL',
    source: 'MANUAL',
    sourceRecordId: null,
    earnedPeriod: null,
    reason: null,
    note: null,
    enteredBy: 'Dr Aisyah',
    enteredAt: '2026-01-20T02:00:00.000Z',
    editable: true,
    bucket: 'OTHER_INCOME',
    column: 'Other income',
    origin: 'Entered by Dr Aisyah',
    sourceLink: null,
    ...over,
  };
}

/** January as the user described it: OT, a procedure incentive, an allowance, last month's locum and a BOD fee. */
const january = (): PayrollInputRow[] => [
  line({ id: 'in-ot', componentCode: 'OVERTIME', itemName: 'Overtime', amount: '412.50', source: 'ATTENDANCE', editable: false, bucket: 'OWN_COLUMN', column: 'OT h', origin: 'From attendance: overtime approved on the timesheet', sourceLink: '/admin/hr/attendance?staffId=staff-1&month=2026-01' }),
  line({ id: 'in-inc', componentCode: 'INCENTIVE', itemName: 'Incentive', label: 'Incentive', amount: '1250.00', source: 'INCENTIVE', editable: false, origin: 'From the incentive run for this month', sourceLink: '/admin/hr/incentives' }),
  line({ id: 'in-rec', componentCode: 'ALLOWANCE', itemName: 'Allowance', label: 'Housing', amount: '300.00', source: 'RECURRING', sourceRecordId: 'ri-1', editable: false, origin: 'Recurring item on the employee record', sourceLink: '/admin/hr/employees/staff-1?tab=employment' }),
  line({ id: 'in-loc', componentCode: 'LOCUM_FEE', itemName: 'Locum fee', amount: '900.00', earnedPeriod: '2025-12-01', reason: 'Three December sessions' }),
  line({ id: 'in-bod', componentCode: 'DIRECTOR_FEE', itemName: "Director's fee", amount: '2000.00' }),
  line({ id: 'in-ded', componentCode: 'ADVANCE_RECOVERY', itemName: 'Advance recovery', amount: '150.00', bucket: 'DEDUCTION', column: 'Other' }),
];

vi.mock('../hooks/useAdmin', () => ({
  usePayrollInputs: () => ({ data: inputRows, isLoading: false }),
  usePayComponents: () => ({
    data: {
      components: [
        { code: 'BASIC', name: 'Basic pay', type: 'ADDITION', active: true },
        { code: 'ALLOWANCE', name: 'Allowance', type: 'ADDITION', active: true },
        { code: 'DIRECTOR_FEE', name: "Director's fee", type: 'ADDITION', active: true },
        { code: 'LOCUM_FEE', name: 'Locum fee', type: 'ADDITION', active: true },
        { code: 'BOD_FEE', name: 'BOD fee', type: 'ADDITION', active: true },
        { code: 'ADVANCE_RECOVERY', name: 'Advance recovery', type: 'DEDUCTION', active: true },
        { code: 'RETIRED', name: 'Retired item', type: 'ADDITION', active: false },
      ],
    },
  }),
  useUpsertPayrollInput: () => ({ mutateAsync: upsertMutate, isPending: false }),
  useDeletePayrollInput: () => ({ mutateAsync: removeMutate, isPending: false }),
  useCalculatePayroll: () => ({ mutateAsync: calculateMutate, isPending: false }),
}));

const { PayrollInputsDrawer } = await import('./PayrollInputsDrawer');

function show(over: Partial<Parameters<typeof PayrollInputsDrawer>[0]> = {}) {
  return render(
    <AntApp>
      <MemoryRouter>
        <PayrollInputsDrawer
          open
          onClose={() => {}}
          period="2026-01-01"
          staffId="staff-1"
          staffName="Dr Meera Kaur"
          canEdit
          runId="run-1"
          cell={{ otherIncome: '4450.00', otherDeductions: '150.00' }}
          {...over}
        />
      </MemoryRouter>
    </AntApp>,
  );
}

const group = (title: string) => screen.getByRole('region', { name: title });

beforeEach(() => {
  upsertMutate.mockReset().mockResolvedValue({});
  removeMutate.mockReset().mockResolvedValue({});
  calculateMutate.mockReset().mockResolvedValue({});
  inputRows = january();
});

describe('the month’s items for one person', () => {
  it('groups the lines by the register cell that counts them, with the subtotal the cell shows', () => {
    show();
    // 1,250 + 300 + 900 + 2,000 — everything in gross other than basic, overtime and claims.
    expect(screen.getByTestId('subtotal-OTHER_INCOME')).toHaveTextContent('4,450.00');
    expect(screen.getByTestId('subtotal-DEDUCTION')).toHaveTextContent('150.00');
    const income = group('Counted in Other income');
    for (const name of ['Incentive', 'Housing', 'Locum fee', "Director's fee"]) expect(within(income).getByText(name)).toBeVisible();
    // Overtime is in its own column and is not part of Other income.
    expect(within(group('In their own columns')).getByText('Overtime')).toBeVisible();
    expect(within(income).queryByText('Overtime')).toBeNull();
    expect(within(group('Deductions')).getByText('Advance recovery')).toBeVisible();
    // The register agrees with the lines, so nothing says otherwise.
    expect(screen.queryByText(/has not been worked out since/)).toBeNull();
  });

  it('says where a derived line came from, links to where it is corrected, and offers no edit on it', () => {
    show();
    const own = group('In their own columns');
    expect(within(own).getByText('From attendance: overtime approved on the timesheet')).toBeVisible();
    expect(within(own).getByRole('link', { name: 'Correct at source' })).toHaveAttribute('href', '/admin/hr/attendance?staffId=staff-1&month=2026-01');
    expect(within(own).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(within(own).queryByRole('button', { name: 'Edit' })).toBeNull();
    const income = group('Counted in Other income');
    expect(within(income).getByText('Recurring item on the employee record')).toBeVisible();
    // The hand-keyed lines are the ones with Edit and Remove: the locum fee and the director's fee.
    expect(within(income).getAllByRole('button', { name: 'Edit' })).toHaveLength(2);
    expect(within(income).getAllByRole('button', { name: 'Remove' })).toHaveLength(2);
    // Last month's work, paid this month, says so.
    expect(within(income).getByText('Earned Dec 2025')).toBeVisible();
  });

  it('adds a line from the clinic’s own Payroll items and then works the month out again', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    // The clinic's own item, added under Payroll items, is offered; basic pay and a retired item are not.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Item' }));
    expect(await screen.findByTitle('BOD fee (BOD_FEE)')).toBeInTheDocument();
    expect(screen.queryByTitle('Basic pay (BASIC)')).toBeNull();
    expect(screen.queryByTitle('Retired item (RETIRED)')).toBeNull();
    fireEvent.click(screen.getByTitle('BOD fee (BOD_FEE)'));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '1500' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: 'Board meeting, January' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));

    await waitFor(() => expect(upsertMutate).toHaveBeenCalled());
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      staffId: 'staff-1',
      period: '2026-01-01',
      componentCode: 'BOD_FEE',
      amount: '1500.00',
      kind: 'ADDITIONAL',
      reason: 'Board meeting, January',
    });
    await waitFor(() => expect(calculateMutate).toHaveBeenCalledWith('run-1'));
    expect(await screen.findByText(/Worked out again/)).toBeInTheDocument();
  });

  /*
   * ONE HAND-KEYED LINE PER ITEM PER MONTH. The run keys its rows on the
   * item, so a second director's fee would overwrite the first on the server.
   * The form says so before anything is sent.
   */
  it('refuses a second line of an item that already has one this month, and says to edit it', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Item' }));
    fireEvent.click(await screen.findByTitle("Director's fee (DIRECTOR_FEE)"));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    expect(await screen.findByText(/already a Director's fee line this month\. Edit that line/)).toBeInTheDocument();
    expect(upsertMutate).not.toHaveBeenCalled();
  });

  it('edits a hand-keyed line in place — amount, reason and the month it was earned — never the item', async () => {
    show();
    const income = group('Counted in Other income');
    // The locum fee is the first hand-keyed line in the group.
    fireEvent.click(within(income).getAllByRole('button', { name: 'Edit' })[0]);
    expect(await screen.findByText('Edit Locum fee — January 2026')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Item' })).toBeNull();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '1200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(upsertMutate).toHaveBeenCalled());
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      componentCode: 'LOCUM_FEE',
      amount: '1200.00',
      reason: 'Three December sessions',
      earnedPeriod: '2025-12-01',
    });
    await waitFor(() => expect(calculateMutate).toHaveBeenCalledWith('run-1'));
  });

  it('removes a hand-keyed line and works the month out again', async () => {
    show();
    const income = group('Counted in Other income');
    fireEvent.click(within(income).getAllByRole('button', { name: 'Remove' })[1]);
    await waitFor(() => expect(removeMutate).toHaveBeenCalledWith('in-bod'));
    await waitFor(() => expect(calculateMutate).toHaveBeenCalledWith('run-1'));
  });

  it('says when the register is behind the lines', () => {
    show({ cell: { otherIncome: '2450.00', otherDeductions: '150.00' } });
    expect(screen.getByText(/The register shows RM ?2,450\.00 for this cell/)).toBeVisible();
  });

  it('shows what the server refused, in its words, and keeps the form up', async () => {
    upsertMutate.mockRejectedValueOnce(new Error('The payroll for 2026-01 is already approved. Record an adjustment against that run, or reopen it deliberately.'));
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Item' }));
    fireEvent.click(await screen.findByTitle('BOD fee (BOD_FEE)'));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    expect(await screen.findByText(/already approved/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add line' })).toBeInTheDocument();
    expect(calculateMutate).not.toHaveBeenCalled();
  });

  it('is read-only for a locked month: no add, edit or remove, and says why', () => {
    show({ canEdit: false });
    expect(screen.queryByRole('button', { name: 'Add a line' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.getByText(/Read-only: this month is approved or paid/)).toBeVisible();
  });

  it('points at Payroll items for a kind of pay that does not exist yet', () => {
    show();
    expect(screen.getByRole('link', { name: 'Add it under Payroll items' })).toHaveAttribute('href', '/admin/hr/settings/payroll-items');
  });
});
