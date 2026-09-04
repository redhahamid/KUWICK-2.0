// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatutoryStandingSection } from './EmployeeWorkspacePage';
import type { EmployeeRecord } from '../types';

/**
 * A CLASSIFICATION THIS MONTH DOES NOT RESOLVE MUST NOT READ AS AN ANSWER.
 *
 * The API returns safe fallbacks (EPF applies, no children, no rest day) when
 * no version is in force for the period, so that its own checklist can measure
 * readiness. A screen that printed those beside a resolved employee's real
 * values would say "0 children, Sunday, EPF applies" about somebody nobody has
 * classified — the exact overstatement dating the record removed. Payroll
 * blocks on that employee; this screen has to agree with it.
 */
function record(over: Partial<EmployeeRecord['statutory']>): EmployeeRecord {
  return {
    statutory: {
      epfNumberOnFile: true,
      socsoNumberOnFile: true,
      taxNumberOnFile: false,
      taxCategory: null,
      classificationState: 'RESOLVED',
      classificationNote: 'One statutory classification was in force for the whole period.',
      classificationEffectiveFrom: '2024-01-01',
      epfMembership: 'MALAYSIAN_CITIZEN',
      lindungParticipation: 'NOT_PARTICIPATING',
      taxResidence: 'RESIDENT',
      pcbCategory: 'CATEGORY_1',
      qualifyingChildren: 2,
      restDayOfWeek: 0,
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

describe('the statutory standing panel', () => {
  it('shows the version in force and the date it applied from', () => {
    render(<StatutoryStandingSection data={record({})} />);
    expect(screen.getByText('MALAYSIAN_CITIZEN')).toBeTruthy();
    expect(screen.getByText('NOT_PARTICIPATING')).toBeTruthy();
    expect(screen.getByText('Sunday')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText(/in force since 1 Jan 2024/)).toBeTruthy();
  });

  it('says NOT RECORDED for every field when nothing is in force for the month', () => {
    render(
      <StatutoryStandingSection
        data={record({
          classificationState: 'NONE_ON_RECORD',
          classificationNote: 'No statutory classification is recorded for this employee for this period.',
          classificationEffectiveFrom: null,
        })}
      />,
    );
    // Six facts, all unknown — not one of the API's readiness fallbacks.
    expect(screen.getAllByText('Not recorded')).toHaveLength(6);
    expect(screen.queryByText('Sunday')).toBeNull();
    expect(screen.queryByText('MALAYSIAN_CITIZEN')).toBeNull();
    expect(screen.getByText(/No statutory classification is recorded/)).toBeTruthy();
  });

  it('says the same when two versions overlap the month, because payroll refuses that too', () => {
    render(
      <StatutoryStandingSection
        data={record({
          classificationState: 'CHANGED_MID_PERIOD',
          classificationNote: '2 statutory classifications apply to this period and one field differs between them.',
        })}
      />,
    );
    expect(screen.getAllByText('Not recorded')).toHaveLength(6);
    expect(screen.getByText(/2 statutory classifications apply/)).toBeTruthy();
  });
});
