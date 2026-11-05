import type { ReactNode } from 'react';
import dayjs from 'dayjs';
import {
  useEmployees,
  useLegalEmployers,
  usePayComponents,
  usePayrollApprovalPolicy,
  usePayrollPolicies,
  usePayrollRuns,
  useStatutoryRates,
} from '../hooks/useAdmin';
import { usePublicHolidays } from '../../hr/hooks/usePublicHolidays';
import { useGlobalSetting } from '../../core/hooks/useGlobalSetting';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { payDateLabel } from './PayDateCell';
import type { LegalEmployerRow } from '../types';

export type SetupStepKey = 'company' | 'bank' | 'payRules' | 'items' | 'holidays' | 'opening' | 'employees' | 'rates';

export interface SetupStep {
  key: SetupStepKey;
  title: string;
  done: boolean;
  /** One short line under the title in the step list: a fact when done, what is missing when not. */
  summary: string;
  /** One sentence under the step's heading. */
  intro: string;
}

/** The answer to "did this clinic already run payroll this year in another system?". */
export const OPENING_BALANCES_SETTING = 'hr.setup.openingBalances';
export type OpeningBalancesAnswer = { answer: 'NONE' | 'IMPORTED'; year: number };

/**
 * WHO APPROVES, in a few words, the same rule the server enforces
 * (payroll-approval-rule.ts). The owner's exemption is part of the rule, so it
 * is said here too: a one-person clinic read "Somebody other than the
 * preparer" and then approved alone (Payroll A–Z guide, issue 4).
 */
export function approvedByLabel(policy: { mode: string; allowOwnerSelfApproval: boolean; approvers?: { total: number } }): string {
  const ownerAlone = policy.allowOwnerSelfApproval && policy.mode !== 'STANDARD';
  const onlyOne = (policy.approvers?.total ?? 2) <= 1;
  switch (policy.mode) {
    case 'STANDARD':
      return 'One approver, who may be the person who ran it';
    case 'MAKER_CHECKER':
      if (ownerAlone && onlyOne) return 'The owner alone (nobody else can approve yet)';
      return ownerAlone ? 'Somebody other than the person who ran it; the owner may approve their own' : 'Somebody other than the person who ran it';
    case 'DUAL_APPROVAL':
      return ownerAlone ? 'Two people, not the person who ran it; the owner may approve their own' : 'Two people, not the person who ran it';
    default:
      return policy.mode;
  }
}

/** The bank account is its own step; everything else the Company page calls missing is the first step. */
const BANK_MISSING = 'Bank account for payment';

/**
 * THE EMPLOYERS SETUP IS ABOUT: those with staff, or every active one while
 * nobody is employed yet (new-clinic UAT, 15 October 2026: a clinic with no
 * staff was told "Setup complete" while its only employer still had numbers
 * missing).
 */
export function employersToSetUp(rows: LegalEmployerRow[]) {
  const active = rows.filter((row) => row.active);
  const withStaff = active.filter((row) => (row.employeeCount ?? 0) > 0);
  return withStaff.length > 0 ? withStaff : active;
}

/** What the Company page calls missing, minus the bank account, which has its own step. */
export function companyMissing(rows: LegalEmployerRow[]) {
  return employersToSetUp(rows).flatMap((row) => (row.statutoryReadiness?.missing ?? []).filter((item) => item !== BANK_MISSING));
}

/**
 * WHERE PAYROLL SETUP STANDS, read once for every screen that asks: the
 * wizard, the Settings home, the HR landing and the Add employee review all
 * use these steps, so they cannot disagree about what is still to do.
 */
export function useHrSetup() {
  const { clinicId } = useClinicFilter();
  const employers = useLegalEmployers();
  const components = usePayComponents();
  const approval = usePayrollApprovalPolicy();
  const policies = usePayrollPolicies();
  const holidays = usePublicHolidays();
  const runs = usePayrollRuns({ clinicId });
  const rates = useStatutoryRates();
  const employees = useEmployees({ clinicId });
  const opening = useGlobalSetting<OpeningBalancesAnswer>(OPENING_BALANCES_SETTING);

  const employerRows = employers.data ?? [];
  const setUp = employersToSetUp(employerRows);
  const componentRows = (components.data?.components ?? []).filter((row) => row.active);
  // People with an HR record. A login with no employment record (the owner's own account) is not an employee.
  const employeeCount = (employees.data ?? []).filter((row) => row.active && row.hasProfile).length;
  const clinicCheck = rates.data?.check ?? null;
  const acknowledged = clinicCheck && clinicCheck.current ? clinicCheck : null;
  const rule = (policies.data?.policies ?? []).find((row) => row.isDefault) ?? policies.data?.policies[0] ?? null;
  const missing = companyMissing(employerRows);
  const withoutBank = setUp.filter((row) => !row.bankAccountOnFile);
  const thisYear = dayjs().year();
  const holidaysThisYear = (holidays.data ?? []).filter((row) => dayjs(row.date).year() === thisYear).length;
  const ranPayroll = (runs.data ?? []).some((row) => row.status !== 'CANCELLED');
  const openingAnswer = opening.data ?? null;

  const partMonth = rule ? (rule.partMonthBasis === 'WORKING_DAYS' ? 'Working days' : 'Calendar days') : 'Calendar days';
  const overtimeOn = rule?.overtime.days ? `${rule.overtime.days} days` : 'Days in the month';

  /** Items grouped by when they are paid, largest group first. */
  const payDates = Object.entries(
    componentRows.reduce<Record<string, string[]>>((groups, row) => {
      const label = payDateLabel(row);
      (groups[label] ??= []).push(row.name);
      return groups;
    }, {}),
  ).sort((a, b) => b[1].length - a[1].length);
  const names = (list: string[]) => (list.length > 3 ? `${list.slice(0, 3).join(', ')} +${list.length - 3}` : list.join(', '));
  const rates3 = rates.data;
  const editionOf = (schedule: { effectiveFrom: string } | null | undefined) =>
    schedule ? dayjs(schedule.effectiveFrom).format('D MMM YYYY') : '—';

  const steps: SetupStep[] = [
    {
      key: 'company',
      title: 'Company & statutory numbers',
      done: setUp.length > 0 && missing.length === 0,
      summary:
        setUp.length === 0
          ? 'No company yet'
          : missing.length > 0
            ? `${missing.length} missing`
            : 'Numbers and HRD class on file',
      intro: 'The company that employs and pays the staff. These numbers print on payslips and on what you file each month.',
    },
    {
      key: 'bank',
      title: 'Company bank account',
      done: setUp.length > 0 && withoutBank.length === 0,
      summary: setUp.length > 0 && withoutBank.length === 0 ? 'On file' : 'Not on file',
      intro: 'The account salaries are paid from. It goes on the bank payment listing.',
    },
    {
      key: 'payRules',
      title: 'Pay rules',
      // Kuwick's rules apply until the clinic sets its own, so there is always an answer.
      done: true,
      summary: `${partMonth === 'Calendar days' ? 'Calendar-day' : 'Working-day'} part months · overtime on ${overtimeOn}`,
      intro: 'How a part month, overtime and holiday pay are worked out, and who approves a payroll month.',
    },
    {
      key: 'items',
      title: 'Payroll items',
      done: componentRows.length > 0,
      summary:
        componentRows.length > 0
          ? `${componentRows.length} in use · ${payDates.length} pay date${payDates.length === 1 ? '' : 's'}`
          : 'None set up',
      intro: 'What the clinic pays and deducts, and when each is paid.',
    },
    {
      key: 'holidays',
      title: 'Public holidays',
      done: holidaysThisYear > 0,
      summary: holidaysThisYear > 0 ? `${holidaysThisYear} days in ${thisYear}` : `None for ${thisYear}`,
      intro: 'Work on a public holiday is paid at the holiday rate, so payroll needs the clinic’s holidays.',
    },
    {
      key: 'opening',
      title: 'Opening balances',
      done: Boolean(openingAnswer) || ranPayroll,
      summary: openingAnswer
        ? openingAnswer.answer === 'NONE'
          ? 'First payroll this year'
          : 'Earlier months brought in'
        : ranPayroll
          ? 'Payroll already run here'
          : 'Not answered',
      intro: 'Did this clinic already run payroll this year in another system? Monthly tax counts the whole year, so earlier months matter.',
    },
    {
      key: 'employees',
      title: 'Employees',
      done: employeeCount > 0,
      summary: employeeCount > 0 ? `${employeeCount} ${employeeCount === 1 ? 'employee' : 'employees'}` : 'Nobody to pay yet',
      intro: 'Salary, bank account and statutory details for each person, kept on the Employees page.',
    },
    {
      key: 'rates',
      title: 'Statutory rates',
      done: Boolean(acknowledged),
      summary: acknowledged
        ? `Seen ${dayjs(acknowledged.checkedAt).format('D MMM YYYY')}`
        : clinicCheck
          ? 'New edition to look at'
          : 'Not seen yet',
      intro: 'The official EPF, SOCSO and EIS tables Kuwick uses. Look at which editions they are and acknowledge them.',
    },
  ];

  const facts: Partial<Record<SetupStepKey, { label: string; value: ReactNode }[]>> = {
    payRules: [
      { label: 'Part-month pay', value: partMonth },
      { label: 'Overtime worked out on', value: overtimeOn },
      {
        label: 'Approved by',
        value: approval.data ? approvedByLabel(approval.data) : 'One approver',
      },
    ],
    // Every pay date, one row each, then what is in use when there are fewer than three dates.
    items: [
      ...(payDates.length
        ? payDates.map(([label, list]) => ({ label: `Paid on the ${label}`, value: names(list) }))
        : [{ label: 'Paid on', value: 'Nothing set up yet' }]),
      ...(payDates.length < 3
        ? [
            {
              label: 'In use',
              value: `${componentRows.filter((row) => row.type !== 'DEDUCTION').length} add · ${componentRows.filter((row) => row.type === 'DEDUCTION').length} deduct`,
            },
          ]
        : []),
    ],
    employees: [
      { label: 'Employees', value: employeeCount },
      { label: 'Where', value: 'The Employees page' },
    ],
    rates: [
      { label: 'EPF', value: `${rates3?.epf?.schedule?.authority ?? 'KWSP'} · in force from ${editionOf(rates3?.epf?.schedule)}` },
      { label: 'SOCSO', value: `${rates3?.socso?.schedule?.authority ?? 'PERKESO'} · in force from ${editionOf(rates3?.socso?.schedule)}` },
      { label: 'EIS', value: `${rates3?.eis?.schedule?.authority ?? 'PERKESO'} · in force from ${editionOf(rates3?.eis?.schedule)}` },
      {
        label: 'Acknowledged',
        value: clinicCheck
          ? `${dayjs(clinicCheck.checkedAt).format('D MMM YYYY')}${clinicCheck.checkedBy ? `, ${clinicCheck.checkedBy}` : ''}${clinicCheck.current ? '' : ' · a newer edition since'}`
          : 'Not yet',
      },
    ],
  };

  const queries = [employers, components, employees, rates, holidays, opening];
  return {
    steps,
    facts,
    complete: steps.every((step) => step.done),
    loading: queries.some((query) => query.isLoading),
    error: [employers, components, approval, policies].find((query) => query.error)?.error ?? null,
    employerRows,
    componentRows,
    payDates,
    holidaysThisYear,
    thisYear,
    runs: runs.data ?? [],
    partMonth,
    overtimeOn,
  };
}
