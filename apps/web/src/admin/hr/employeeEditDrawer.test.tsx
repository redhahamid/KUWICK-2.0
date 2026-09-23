// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EmployeeRecord } from '../types';

/**
 * THE EMPLOYING COMPANY HAD TO BE SETTABLE.
 *
 * The record PRINTED "Employed by" and no screen in the product could change
 * it: the Add employee wizard has no such field, the edit drawer had none, and
 * the mutation that calls the endpoint existed but nothing rendered it. A
 * payroll run refuses on NO_LEGAL_EMPLOYER and that refusal is not
 * overridable, so an employee added entirely through the screens could never
 * be paid — the wall a clinic hits on its very first month.
 *
 * These cases pin the field and, just as importantly, the ORDER: the company
 * move is the one thing the server refuses outright, so it goes first and a
 * refusal must leave the rest of the record alone.
 */
const assignMutate = vi.fn().mockResolvedValue({});
const upsertMutate = vi.fn().mockResolvedValue({});
const standingMutate = vi.fn().mockResolvedValue({});

/**
 * THE REST DAY WAS THE SECOND FIELD WITH NO WAY IN.
 *
 * It is PRINTED on this tab, under Working days, and payroll refuses a month
 * without it — but the only input in the product was the statutory standing
 * form, and that form could not reach an employee's first month at all. A
 * clinic hiring from 1 January could not run January: three employees blocked,
 * RM0.00 in every column, and nothing on the screen that said Rest day to
 * press. It is part of the dated standing, so setting it here writes there.
 */
type Version = {
  id: string;
  effectiveFrom: string;
  current: boolean;
  restDayOfWeek: number | null;
};
let versions: Version[] = [];

const EMPLOYERS = [
  { id: 'emp-1', name: 'Klinik Contoh Sdn Bhd', active: true },
  { id: 'emp-2', name: 'Klinik Cawangan Sdn Bhd', active: true },
  { id: 'emp-old', name: 'Syarikat Lama Sdn Bhd', active: false },
];

vi.mock('../hooks/useAdmin', () => ({
  useUpsertEmployee: () => ({ mutateAsync: upsertMutate, isPending: false }),
  useAssignEmployer: () => ({ mutateAsync: assignMutate, isPending: false }),
  useEmployees: () => ({ data: [] }),
  useLegalEmployers: () => ({ data: EMPLOYERS }),
  useStatutoryClassifications: () => ({ data: versions, isLoading: false }),
  useRecordStatutoryClassification: () => ({ mutateAsync: standingMutate, isPending: false }),
}));

const { EmployeeEditDrawer } = await import('./EmployeeEditDrawer');

function record(over: Partial<EmployeeRecord['employment']> = {}): EmployeeRecord {
  return {
    identity: { fullName: 'Nurul Hidayah' },
    employment: {
      employeeNo: 'E-001',
      position: 'Clinic assistant',
      department: null,
      employmentType: 'PERMANENT',
      employmentStatus: 'ACTIVE',
      clinicName: 'Branch A',
      legalEmployerId: 'emp-1',
      legalEmployerName: 'Klinik Contoh Sdn Bhd',
      manager: null,
      startDate: '2024-01-01',
      confirmedDate: null,
      endDate: null,
      endReason: null,
      notes: null,
      ...over,
    },
    statutory: {
      epfNumberOnFile: true,
      socsoNumberOnFile: true,
      taxNumberOnFile: true,
      classificationState: 'RESOLVED',
      restDayOfWeek: versions.find((row) => row.current)?.restDayOfWeek ?? null,
    },
    pay: { bankName: 'Maybank', bankAccountOnFile: true },
  } as unknown as EmployeeRecord;
}

function open(over: Partial<EmployeeRecord['employment']> = {}) {
  assignMutate.mockClear();
  upsertMutate.mockClear();
  standingMutate.mockClear();
  assignMutate.mockResolvedValue({});
  standingMutate.mockResolvedValue({});
  render(<EmployeeEditDrawer staffId="staff-1" data={record(over)} section="employment" onClose={() => {}} />);
}

const employerBox = () => screen.getByLabelText('Employed by');
const saveButton = () => screen.getByRole('button', { name: 'Save' });

/** antd's Select is a combobox: open it, then click the option by name. */
async function choose(name: string) {
  fireEvent.mouseDown(employerBox());
  const option = await screen.findByTitle(name);
  fireEvent.click(option);
}

describe('the employing company, on the employment tab', () => {
  it('offers the company and opens on the one the employee is already on', () => {
    open();
    expect(employerBox()).toBeVisible();
    expect(screen.getByTitle('Klinik Contoh Sdn Bhd')).toBeVisible();
  });

  it('sends the change to the endpoint that has the rules, before the rest of the record', async () => {
    open();
    await choose('Klinik Cawangan Sdn Bhd');
    fireEvent.click(saveButton());

    await waitFor(() => expect(upsertMutate).toHaveBeenCalled());
    expect(assignMutate).toHaveBeenCalledWith({ staffId: 'staff-1', legalEmployerId: 'emp-2' });
    // The company move is the one the server can refuse outright, so it goes
    // first: a refusal must not leave half the record already written.
    expect(assignMutate.mock.invocationCallOrder[0]).toBeLessThan(upsertMutate.mock.invocationCallOrder[0]);
    // And it is NOT smuggled into the profile write, which has no such field.
    expect(upsertMutate.mock.calls[0][0]).not.toHaveProperty('legalEmployerId');
  });

  it('leaves the company alone when nothing about it was touched', async () => {
    open();
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'Senior clinic assistant' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(upsertMutate).toHaveBeenCalled());
    expect(assignMutate).not.toHaveBeenCalled();
  });

  it('records somebody who had no company at all — the case that blocks a first payroll', async () => {
    open({ legalEmployerId: null, legalEmployerName: null });
    await choose('Klinik Contoh Sdn Bhd');
    fireEvent.click(saveButton());

    await waitFor(() => expect(assignMutate).toHaveBeenCalledWith({ staffId: 'staff-1', legalEmployerId: 'emp-1' }));
  });

  /*
   * THE SERVER REFUSES A MOVE once the person is on an approved run, because
   * their contributions were already reported under the company that was on
   * it. The screen has to show that and stop — not save the rest and leave the
   * operator believing the move went through.
   */
  it('shows the server’s refusal and writes nothing else', async () => {
    open();
    assignMutate.mockRejectedValueOnce(new Error('This employee appears on 2 approved payroll line(s) under their current employer.'));
    await choose('Klinik Cawangan Sdn Bhd');
    fireEvent.click(saveButton());

    expect(await screen.findByText(/appears on 2 approved payroll line/)).toBeVisible();
    expect(upsertMutate).not.toHaveBeenCalled();
  });

  /*
   * An archived company is refused by the server, so it is not offered — but
   * somebody sitting on one still has to see where they are, or the box reads
   * empty and the screen looks like it lost the fact.
   */
  it('does not offer an archived company', async () => {
    open();
    fireEvent.mouseDown(employerBox());
    // Waiting on a company only the DROPDOWN carries: the selected one also
    // wears a `title`, so it is on screen either way and proves nothing.
    await screen.findByTitle('Klinik Cawangan Sdn Bhd');
    expect(screen.queryByTitle('Syarikat Lama Sdn Bhd')).toBeNull();
    expect(screen.queryByTitle('Syarikat Lama Sdn Bhd (archived)')).toBeNull();
  });

  it('still shows an archived company to the person sitting on it, marked as archived', async () => {
    open({ legalEmployerId: 'emp-old', legalEmployerName: 'Syarikat Lama Sdn Bhd' });
    fireEvent.mouseDown(employerBox());
    // The selected item wears the same `title` as its option, so both are on
    // screen — what matters is that one of them is an OPTION to choose.
    const marked = await screen.findAllByTitle('Syarikat Lama Sdn Bhd (archived)');
    expect(marked.some((element) => element.closest('.ant-select-item-option'))).toBe(true);
  });
});

describe('the rest day, on the employment tab', () => {
  /** antd's Select is a combobox: open it, then click the option by name. */
  async function chooseDay(name: string) {
    fireEvent.mouseDown(screen.getByLabelText('Rest day'));
    fireEvent.click(await screen.findByTitle(name));
  }

  it('is on the tab that already prints it, and says which date it will land on', async () => {
    versions = [{ id: 'v1', effectiveFrom: '2026-01-01', current: true, restDayOfWeek: null }];
    open({ startDate: '2026-01-01' });
    expect(screen.getByLabelText('Rest day')).toBeVisible();
    // Never silently: the rest day is part of a DATED standing, so the screen
    // states the date it is about to write against before it writes it.
    expect(screen.getByText(/Recorded from 1 Jan 2026, where their standing starts/)).toBeVisible();
  });

  /*
   * NEVER RECORDED BEFORE means it was always true, so it goes on the standing
   * the employee already has — their FIRST month — rather than opening a
   * version from today that leaves January still blocked.
   */
  it('writes it against the standing that is already there, not against this month', async () => {
    versions = [{ id: 'v1', effectiveFrom: '2026-01-01', current: true, restDayOfWeek: null }];
    open({ startDate: '2026-01-01' });
    await chooseDay('Sunday');
    fireEvent.click(saveButton());

    await waitFor(() => expect(standingMutate).toHaveBeenCalled());
    expect(standingMutate).toHaveBeenCalledWith({
      staffId: 'staff-1',
      effectiveFrom: '2026-01-01',
      restDayOfWeek: 0,
      reason: 'Rest day recorded on the employment record',
    });
  });

  /*
   * A version created while the rest day was silent is silent too, because the
   * standing carries forward what it was given. Filling only the earliest
   * would leave a later month blocked with nothing on this screen to say why.
   */
  it('fills every version that is silent about it, not just the first', async () => {
    versions = [
      { id: 'v2', effectiveFrom: '2026-04-01', current: true, restDayOfWeek: null },
      { id: 'v1', effectiveFrom: '2026-01-01', current: false, restDayOfWeek: null },
    ];
    open({ startDate: '2026-01-01' });
    expect(screen.getByText(/across all 2 versions of their standing/)).toBeVisible();
    await chooseDay('Sunday');
    fireEvent.click(saveButton());

    await waitFor(() => expect(standingMutate).toHaveBeenCalledTimes(2));
    expect(standingMutate.mock.calls.map((call) => call[0].effectiveFrom).sort()).toEqual(['2026-01-01', '2026-04-01']);
  });

  /*
   * ALREADY RECORDED makes this a CHANGE, and a change is dated: the months
   * already worked out keep the day they were worked out with.
   */
  it('opens a new version when the day is being changed, not rewriting the old months', async () => {
    versions = [{ id: 'v1', effectiveFrom: '2026-01-01', current: true, restDayOfWeek: 0 }];
    open({ startDate: '2026-01-01' });
    expect(screen.getByText(/A change takes effect from/)).toBeVisible();
    await chooseDay('Friday');
    fireEvent.click(saveButton());

    await waitFor(() => expect(standingMutate).toHaveBeenCalled());
    const sent = standingMutate.mock.calls[0][0];
    expect(sent.restDayOfWeek).toBe(5);
    expect(sent.effectiveFrom).not.toBe('2026-01-01');
    expect(sent.effectiveFrom).toMatch(/^\d{4}-\d{2}-01$/);
  });

  /*
   * The employment record is written before the rest day is, so a refusal of
   * the rest day — a month already approved with a different day in it — must
   * say that the record saved and the day did not, or the operator retypes a
   * record that is already there.
   */
  it('names the rest day when that is what the server refused', async () => {
    versions = [{ id: 'v1', effectiveFrom: '2026-01-01', current: true, restDayOfWeek: null }];
    open({ startDate: '2026-01-01' });
    standingMutate.mockRejectedValueOnce(new Error('1 approved payroll run(s) cover this date or later for this employee.'));
    await chooseDay('Sunday');
    fireEvent.click(saveButton());

    expect(await screen.findByText(/The employment record is saved, but the rest day was refused/)).toBeVisible();
    expect(screen.getByText(/1 approved payroll run/)).toBeVisible();
    expect(upsertMutate).toHaveBeenCalled();
  });

  it('leaves the standing alone when the rest day was not touched', async () => {
    versions = [{ id: 'v1', effectiveFrom: '2026-01-01', current: true, restDayOfWeek: 0 }];
    open({ startDate: '2026-01-01' });
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'Senior clinic assistant' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(upsertMutate).toHaveBeenCalled());
    expect(standingMutate).not.toHaveBeenCalled();
  });
});
