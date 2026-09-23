// @vitest-environment jsdom
import { App } from 'antd';
import { fireEvent, render as renderBare, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmployeeRecord, StatutoryClassificationVersion } from '../types';

/**
 * THE FIRST STANDING A CLINIC EVER RECORDS HAS TO BE REACHABLE.
 *
 * The Add employee form writes a standing FROM THE JOIN DATE carrying only
 * the three things it asks for. Everything else about that employee's first
 * month — LINDUNG, the rest day, the MTD category — has to land on that same
 * row: there is no earlier date to record it from, and a row dated later
 * leaves the first month unanswered and its payroll blocked.
 *
 * "Record a change" alone could not do it. It proposes the CURRENT month, and
 * a statement dated at the row that was already there was refused outright
 * with advice — correct that row instead — that pointed at nothing. So a
 * clinic onboarding staff from 1 January could not run January at all.
 */
const recordMutate = vi.fn().mockResolvedValue({});
const deleteMutate = vi.fn();

const JOINED = '2026-01-01';

function version(over: Partial<StatutoryClassificationVersion> = {}): StatutoryClassificationVersion {
  return {
    id: 'v-1',
    effectiveFrom: JOINED,
    effectiveTo: null,
    current: true,
    epfApplicable: true,
    epfMembership: 'MALAYSIAN_CITIZEN',
    epfEmployeeRate: null,
    socsoApplicable: true,
    eisApplicable: true,
    lindungParticipation: null,
    pcbApplicable: true,
    taxResidence: null,
    pcbCategory: null,
    qualifyingChildren: 0,
    disabledSelf: false,
    disabledSpouse: false,
    restDayOfWeek: null,
    overtimeContractPolicy: null,
    reason: 'Recorded when the employee was added',
    note: null,
    recordedBy: 'Dr Aisyah',
    recordedAt: '2026-01-01T02:00:00.000Z',
    changed: [],
    ...over,
  };
}

let versions: StatutoryClassificationVersion[] = [version()];

vi.mock('../hooks/useAdmin', () => ({
  useStatutoryClassifications: () => ({ data: versions, isLoading: false }),
  useRecordStatutoryClassification: () => ({ mutateAsync: recordMutate, isPending: false }),
  useDeleteStatutoryClassification: () => ({ mutate: deleteMutate, isPending: false }),
}));
vi.mock('../../core/hooks/useCan', () => ({ useCan: () => true }));

const { StatutoryStandingManager } = await import('./StatutoryStandingManager');

/**
 * The employee record as the screen has it in SEPTEMBER, months after the join
 * date: the standing resolves for today, so the panel shows today's answers.
 * A correction must not quietly copy those back into January.
 */
function record(over: Partial<EmployeeRecord['statutory']> = {}): EmployeeRecord {
  return {
    staffId: 'staff-1',
    statutory: {
      epfNumberOnFile: true,
      socsoNumberOnFile: true,
      taxNumberOnFile: false,
      taxCategory: null,
      classificationState: 'RESOLVED',
      classificationNote: 'One statutory classification was in force for the whole period.',
      classificationEffectiveFrom: JOINED,
      epfMembership: 'MALAYSIAN_CITIZEN',
      lindungParticipation: 'ENROLLED',
      taxResidence: 'RESIDENT',
      pcbCategory: 'CATEGORY_3',
      qualifyingChildren: 2,
      restDayOfWeek: 5,
      overtimeContractPolicy: null,
      epfApplicable: true,
      socsoApplicable: true,
      eisApplicable: true,
      pcbApplicable: true,
      note: 'Identifiers and applicability.',
      ...over,
    },
  } as unknown as EmployeeRecord;
}

/**
 * Rendered inside antd's `App`, as `main.tsx` renders the whole product. A
 * component that reads the message context from a host that has not provided
 * one is being tested in a configuration this product does not ship.
 */
const render = (node: React.ReactElement) => renderBare(<App>{node}</App>);

const ok = (name: string) => screen.getByRole('button', { name });
const reasonBox = () => screen.getByLabelText('Reason');
/*
 * antd keeps a closed modal in the DOM and hides its wrapper, and hides it
 * again for a frame while it animates IN. So "is the form up" is the
 * wrapper's own display, not whether the title can be found.
 */
const formIsUp = () => {
  const wrap = document.querySelector('.ant-modal-wrap') as HTMLElement | null;
  return Boolean(wrap) && wrap!.style.display !== 'none';
};

/** antd's Select is a combobox: open it, then click the option by name. */
async function choose(label: string, option: string) {
  fireEvent.mouseDown(screen.getByLabelText(label));
  fireEvent.click(await screen.findByTitle(option));
}

beforeEach(() => {
  recordMutate.mockClear();
  recordMutate.mockResolvedValue({});
  deleteMutate.mockReset();
  versions = [version()];
});

describe('correcting the standing that is already on a date', () => {
  it('offers a way in to the first row, which nothing else in the product could reach', () => {
    render(<StatutoryStandingManager data={record()} />);
    expect(screen.getByRole('button', { name: /Correct/ })).toBeVisible();
  });

  it('opens on that row’s own date, and states it rather than the month we happen to be in', async () => {
    render(<StatutoryStandingManager data={record()} />);
    fireEvent.click(screen.getByRole('button', { name: /Correct/ }));

    await screen.findByText('Correct the standing from 1 Jan 2026');
    expect(screen.getByLabelText('In force from')).toHaveValue('1 Jan 2026');
    // The date IS the row. Moving it would make this a different version of a
    // different period, which is what "Record a change" is for.
    expect(screen.getByLabelText('In force from')).toBeDisabled();
  });

  it('posts the answers against the join date, so the first month has them', async () => {
    render(<StatutoryStandingManager data={record()} />);
    fireEvent.click(screen.getByRole('button', { name: /Correct/ }));
    await screen.findByText('Correct the standing from 1 Jan 2026');

    await choose('LINDUNG 24 JAM (SKBBK)', 'Opted out through PERKESO');
    await choose('Rest day', 'Sunday');
    fireEvent.change(reasonBox(), { target: { value: 'Completing what the Add employee form did not ask for' } });
    fireEvent.click(ok('Save correction'));

    await waitFor(() => expect(recordMutate).toHaveBeenCalled());
    expect(recordMutate.mock.calls[0][0]).toMatchObject({
      staffId: 'staff-1',
      effectiveFrom: JOINED,
      lindungParticipation: 'NOT_PARTICIPATING',
      restDayOfWeek: 0,
    });
  });

  /*
   * PREFILL FROM THE ROW, AND FROM NOTHING ELSE.
   *
   * The panel shows what is in force TODAY. Filling a correction from that
   * would carry today's answers back into a month that never had them — the
   * opposite of what somebody opening January came to do, and impossible to
   * see once it is saved.
   */
  it('does not carry today’s answers back into the month being corrected', async () => {
    versions = [version({ epfMembership: null, pcbCategory: null, qualifyingChildren: 0 })];
    render(<StatutoryStandingManager data={record()} />);
    fireEvent.click(screen.getByRole('button', { name: /Correct/ }));
    await screen.findByText('Correct the standing from 1 Jan 2026');

    fireEvent.change(reasonBox(), { target: { value: 'Rest day only' } });
    await choose('Rest day', 'Sunday');
    fireEvent.click(ok('Save correction'));

    await waitFor(() => expect(recordMutate).toHaveBeenCalled());
    const sent = recordMutate.mock.calls[0][0];
    expect(sent).not.toHaveProperty('epfMembership');
    expect(sent).not.toHaveProperty('pcbCategory');
    expect(sent.restDayOfWeek).toBe(0);
  });

  /*
   * THE ASK FROM UAT, LITERALLY: close on success. A form that looks the same
   * after a write as after a refusal gets pressed again, and the second press
   * used to come back "a classification already starts on that date" — which
   * reads as "duplicate" and taught the operator to distrust a save that had
   * in fact worked.
   */
  it('closes when the save goes through, so nobody records the same thing twice', async () => {
    render(<StatutoryStandingManager data={record()} />);
    fireEvent.click(screen.getByRole('button', { name: /Correct/ }));
    await screen.findByText('Correct the standing from 1 Jan 2026');

    fireEvent.change(reasonBox(), { target: { value: 'Completing the first month' } });
    await choose('Rest day', 'Sunday');
    fireEvent.click(ok('Save correction'));

    await waitFor(() => expect(formIsUp()).toBe(false), { timeout: 3000 });
  });

  it('keeps the form open and shows what the server said when it refuses', async () => {
    recordMutate.mockRejectedValueOnce(new Error('2 approved payroll run(s) cover this date or later for this employee.'));
    render(<StatutoryStandingManager data={record()} />);
    fireEvent.click(screen.getByRole('button', { name: /Correct/ }));
    await screen.findByText('Correct the standing from 1 Jan 2026');

    fireEvent.change(reasonBox(), { target: { value: 'Too late' } });
    await choose('Rest day', 'Sunday');
    fireEvent.click(ok('Save correction'));

    await screen.findByText(/2 approved payroll run/);
    expect(formIsUp()).toBe(true);
  });
});

describe('recording a change from a date the user picks', () => {
  it('sends the date on the form, not the month the form was opened in', async () => {
    render(<StatutoryStandingManager data={record()} />);
    fireEvent.click(ok('Record a change'));

    const from = await screen.findByLabelText('In force from');
    fireEvent.change(from, { target: { value: '1 Mar 2026' } });
    fireEvent.keyDown(from, { key: 'Enter', keyCode: 13 });
    await waitFor(() => expect(from).toHaveValue('1 Mar 2026'));

    await choose('Rest day', 'Sunday');
    fireEvent.change(reasonBox(), { target: { value: 'Rest day moved to Sunday' } });
    fireEvent.click(ok('Record'));

    await waitFor(() => expect(recordMutate).toHaveBeenCalled());
    expect(recordMutate.mock.calls[0][0].effectiveFrom).toBe('2026-03-01');
  });
});

/*
 * A VERSION RECORDED IN ERROR CAN GO. The September row on STAFF ADMIN only
 * existed because the form once moved the date to the current month, and
 * there was nothing on the screen to remove it. The server decides — an
 * approved month keeps its version — and its refusal is shown in its words.
 */
describe('deleting a version', () => {
  it('asks the server to delete that row, by its id', async () => {
    versions = [version({ id: 'v-sep', effectiveFrom: '2026-09-01' }), version({ id: 'v-jan', effectiveFrom: JOINED, effectiveTo: '2026-08-31', current: false })];
    render(<StatutoryStandingManager data={record()} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    await screen.findByText('Delete the version from 1 Sep 2026?');
    fireEvent.click(ok('Delete version'));

    await waitFor(() => expect(deleteMutate).toHaveBeenCalled());
    expect(deleteMutate.mock.calls[0][0]).toMatchObject({ staffId: 'staff-1', id: 'v-sep' });
  });

  it('shows the refusal for a version an approved month reads, and keeps the row', async () => {
    deleteMutate.mockImplementation((_vars: unknown, handlers: { onError: (e: Error) => void }) =>
      handlers.onError(new Error('An approved payroll run (2026-09) was worked out from this version, so it stays.')),
    );
    render(<StatutoryStandingManager data={record()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText('Delete the version from 1 Jan 2026?');
    fireEvent.click(ok('Delete version'));

    await screen.findByText(/approved payroll run \(2026-09\)/);
    expect(screen.getByRole('button', { name: /Correct/ })).toBeVisible();
  });
});
