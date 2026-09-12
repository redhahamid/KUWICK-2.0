// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MyHome, MyLeaveBalances, MyLeavePreview } from './hooks/useMe';

/*
 * THE PORTAL, after portal-home.html and portal-leave.html — with the hooks
 * mocked, so what is tested is what the pages do with the server's figures:
 * show them, never add them up.
 */

const home: MyHome = {
  date: '2026-09-11',
  timeZone: 'Asia/Kuala_Lumpur',
  fullName: 'Dr Meera Kaur',
  clinicName: 'Contoh Central',
  clock: { onDuty: false, since: null, openSince: null, todayStatus: null },
  todayShifts: [
    { id: 's1', startsAt: '2026-09-11T02:00:00.000Z', endsAt: '2026-09-11T10:00:00.000Z', shiftType: 'WORKING', note: null },
  ],
  nextShift: null,
  upcomingLeave: null,
  waiting: { leaveRequests: 1, claims: 0, attendanceCorrections: 0 },
  latestPayslip: { runId: 'run-aug', period: '2026-08', status: 'PAID', netPay: '9979.14', paymentDate: '2026-08-28' },
  payslips: [
    { runId: 'run-aug', period: '2026-08', status: 'PAID', netPay: '9979.14', paymentDate: '2026-08-28' },
    { runId: 'run-jul', period: '2026-07', status: 'PAID', netPay: '8558.70', paymentDate: '2026-07-28' },
  ],
  leave: { annual: { remaining: 10, available: 16 }, medicalUsed: 2, medicalAvailable: 14, policyName: 'Standard' },
  claims: { awaitingTotal: '180.00', awaitingCount: 1, payrollPeriod: '2026-09' },
  recent: [
    { kind: 'claim', title: 'Claim RM 180.00', state: 'approved', at: '2026-09-06T02:00:00.000Z', href: '/my/claims' },
    { kind: 'payslip', title: 'Payslip August', state: 'ready', at: '2026-08-28T02:00:00.000Z', href: '/my/payslips' },
  ],
};

const balances: MyLeaveBalances = {
  year: 2026,
  policyName: 'Standard',
  balances: [
    { leaveType: 'ANNUAL', paid: true, available: 16, taken: 6, pending: 0, remaining: 10 },
    { leaveType: 'MEDICAL', paid: true, available: 14, taken: 2, pending: 0, remaining: 12 },
    { leaveType: 'UNPAID', paid: false, available: 0, taken: 1, pending: 0, remaining: -1 },
  ],
  unpaidTaken: { days: 1, lastMonth: 'Aug' },
};

const preview: MyLeavePreview = {
  days: 3,
  halfDay: false,
  leaveType: 'ANNUAL',
  balanceAfter: { remaining: 7, available: 16, overdrawn: false },
  ownClash: null,
  clashes: [{ name: 'Wan Azman', startDate: '2026-09-21', endDate: '2026-09-21', status: 'APPROVED', firstDay: '2026-09-21' }],
  publicHolidays: [],
};

const clockMutate = vi.fn().mockResolvedValue({});
const requestLeave = vi.fn().mockResolvedValue({});

vi.mock('./hooks/useMe', () => ({
  useMyHome: () => ({ data: home, isLoading: false }),
  useClockSelf: () => ({ mutateAsync: clockMutate, isPending: false }),
  useMyLeave: () => ({
    data: [
      { id: 'l1', leaveType: 'ANNUAL', startDate: '2026-09-21', endDate: '2026-09-23', status: 'PENDING', reason: null, decidedBy: null, createdAt: '' },
      { id: 'l2', leaveType: 'MEDICAL', startDate: '2026-09-08', endDate: '2026-09-08', status: 'APPROVED', reason: null, decidedBy: 'Rohana Yusof', createdAt: '' },
    ],
    isLoading: false,
  }),
  useMyLeaveBalances: () => ({ data: balances }),
  useMyLeavePreview: (params: unknown) => ({ data: params ? preview : undefined }),
  useRequestLeave: () => ({ mutateAsync: requestLeave, isPending: false }),
  myPayslipPdfPath: (runId: string) => `/me/payslips/${runId}/pdf`,
}));

vi.mock('../core/api-client', () => ({
  ApiError: class ApiError extends Error {},
  downloadFile: vi.fn().mockResolvedValue(undefined),
}));

const { MyHomePage } = await import('./MyHomePage');
const { MyLeavePage } = await import('./MyLeavePage');
const { rm, greetingName, dayRange } = await import('./portal');
const { claimChip, mileageAmount } = await import('./MyClaimsPage');

function mount(node: React.ReactElement) {
  return render(
    <AntApp>
      <MemoryRouter>{node}</MemoryRouter>
    </AntApp>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('portal helpers', () => {
  it('writes money the way the mockup does and greets by title and first name', () => {
    expect(rm('9979.14')).toBe('RM 9,979.14');
    expect(rm(null)).toBe('—');
    expect(greetingName('Dr Meera Kaur')).toBe('Dr Meera');
    expect(greetingName('Nurul Hidayah')).toBe('Nurul');
    expect(dayRange('2026-09-21', '2026-09-23')).toBe('21–23 Sep');
    expect(dayRange('2026-09-08', '2026-09-08')).toBe('8 Sep');
  });

  it('prices mileage at the placeholder rate and names where a claim stands', () => {
    expect(mileageAmount(42)).toBe(25.2);
    expect(claimChip({ status: 'SUBMITTED', whereTheMoneyIs: 'Waiting for your manager.', payrollPeriod: null })).toEqual({ tone: 'attn', label: 'Waiting' });
    expect(claimChip({ status: 'APPROVED', whereTheMoneyIs: 'Approved. It will be paid with your salary in 2026-09.', payrollPeriod: '2026-09' })).toEqual({ tone: 'done', label: 'Approved' });
    expect(claimChip({ status: 'APPROVED', whereTheMoneyIs: 'Paid with your salary.', payrollPeriod: '2026-08' })).toEqual({ tone: 'muted', label: 'Paid Aug' });
    expect(claimChip({ status: 'REJECTED', whereTheMoneyIs: 'Not approved.', payrollPeriod: null })).toEqual({ tone: 'block', label: 'Not approved' });
  });
});

describe('Home', () => {
  it('shows the three figures, the paid months and the four actions, from the server', () => {
    mount(<MyHomePage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hi, Dr Meera');
    expect(screen.getByText(/Contoh Central · shift 10:00–18:00/)).toBeInTheDocument();
    expect(screen.getByText('Latest payslip')).toBeInTheDocument();
    expect(screen.getAllByText('RM 9,979.14').length).toBeGreaterThan(0);
    expect(screen.getByText('10 days')).toBeInTheDocument();
    expect(screen.getByText('of 16 · 2 medical used')).toBeInTheDocument();
    expect(screen.getByText('RM 180.00')).toBeInTheDocument();
    expect(screen.getByText('1 approved, pays with Sep payroll')).toBeInTheDocument();
    expect(screen.getByText('August 2026')).toBeInTheDocument();
    expect(screen.getByText('July 2026')).toBeInTheDocument();
    for (const action of ['Apply for leave', 'Submit a claim', 'Request attendance correction', 'Update bank account']) {
      expect(screen.getByRole('link', { name: action })).toBeInTheDocument();
    }
    expect(screen.getByText('Claim RM 180.00')).toBeInTheDocument();
  });

  it('clocks in from the one button', async () => {
    mount(<MyHomePage />);
    fireEvent.click(screen.getByRole('button', { name: /Clock in/ }));
    expect(clockMutate).toHaveBeenCalledTimes(1);
  });
});

describe('Leave', () => {
  it('shows the balances, the requests and what the request would take', () => {
    mount(<MyLeavePage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Apply for leave');
    expect(screen.getByText('10 of 16 left')).toBeInTheDocument();
    expect(screen.getByText('12 of 14 left')).toBeInTheDocument();
    expect(screen.getByText('1 day (Aug)')).toBeInTheDocument();
    expect(screen.getByText('Waiting')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    // The preview strip is the server's: days, balance after, who else is away.
    expect(screen.getByText('3 days')).toBeInTheDocument();
    expect(screen.getByText('7 of 16')).toBeInTheDocument();
    expect(screen.getByText('Wan Azman is also away on 21 Sep')).toBeInTheDocument();
    // Unpaid has no balance row; it is the "taken" line instead.
    expect(screen.queryByText(/-1 of 0/)).not.toBeInTheDocument();
  });

  it('sends the request with the dates typed and the half-day flag', () => {
    mount(<MyLeavePage />);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-21' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-23' } });
    fireEvent.change(screen.getByLabelText('Half day?'), { target: { value: 'half' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit request/ }));
    expect(requestLeave).toHaveBeenCalledWith({
      leaveType: 'ANNUAL',
      startDate: '2026-09-21',
      endDate: '2026-09-23',
      reason: undefined,
      halfDay: true,
    });
  });
});
