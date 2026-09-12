import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';

/**
 * MY KUWICK — the staff-facing queries.
 *
 * Every one of these hits `/me`, and no call passes a staff id: the server
 * resolves the person from the token. There is nothing to get wrong here
 * because there is nothing to pass.
 */

export interface MyProfile {
  staffId: string;
  fullName: string;
  role: string;
  category: string;
  branch: { id: string; name: string } | null;
  hasEmploymentProfile: boolean;
  employment: {
    employeeNo: string | null;
    position: string | null;
    department: string | null;
    employmentType: string;
    employmentStatus: string;
    startDate: string | null;
    phone: string | null;
    email: string | null;
  } | null;
}

export interface MyShift {
  id: string;
  startsAt: string;
  endsAt: string;
  shiftType: string;
  note: string | null;
}

export interface MyPaidPayslip {
  runId: string;
  /** YYYY-MM. */
  period: string;
  status: string;
  netPay: string;
  /** YYYY-MM-DD, when the run records it. */
  paymentDate: string | null;
}

export interface MyRecentEvent {
  kind: 'claim' | 'payslip' | 'leave';
  title: string;
  state: string;
  at: string;
  href: string;
}

export interface MyHome {
  date: string;
  timeZone: string;
  fullName: string;
  clinicName: string | null;
  clock: {
    onDuty: boolean;
    since: string | null;
    openSince: string | null;
    todayStatus: string | null;
  };
  todayShifts: MyShift[];
  nextShift: { date: string; startsAt: string; endsAt: string; shiftType: string } | null;
  upcomingLeave: { leaveType: string; startDate: string; endDate: string } | null;
  waiting: { leaveRequests: number; claims: number; attendanceCorrections: number };
  /** PAID months only — the payslip an employee keeps. */
  latestPayslip: MyPaidPayslip | null;
  payslips: MyPaidPayslip[];
  leave: {
    annual: { remaining: number; available: number } | null;
    medicalUsed: number;
    medicalAvailable: number | null;
    policyName: string | null;
  };
  claims: { awaitingTotal: string; awaitingCount: number; payrollPeriod: string | null };
  recent: MyRecentEvent[];
}

export interface MyLeaveBalance {
  leaveType: string;
  paid: boolean;
  available: number;
  taken: number;
  pending: number;
  remaining: number;
}

export interface MyLeaveBalances {
  year: number;
  policyName: string | null;
  balances: MyLeaveBalance[];
  unpaidTaken: { days: number; lastMonth: string | null };
}

export interface MyLeavePreview {
  days: number;
  halfDay: boolean;
  leaveType: string | null;
  balanceAfter: { remaining: number; available: number; overdrawn: boolean } | null;
  ownClash: { startDate: string; endDate: string; status: string } | null;
  clashes: { name: string; startDate: string; endDate: string; status: string; firstDay: string }[];
  publicHolidays: { date: string; name: string }[];
}

export interface MyBenefits {
  year: number;
  medical: { allowance: string; used: string; remaining: string } | null;
}

export interface MySchedule {
  from: string;
  to: string;
  shifts: (MyShift & { date: string })[];
  leave: { leaveType: string; startDate: string; endDate: string }[];
  closures: { date: string; reason: string | null }[];
}

export interface MyAttendanceDay {
  id: string;
  workDate: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  status: string;
  lateMinutes: number | null;
  earlyOutMinutes: number | null;
  workedMinutes: number | null;
  extraMinutesRecorded: number;
  overtimeApproved: boolean;
  corrected: boolean;
  correctionRequest: {
    id: string;
    status: string;
    reason: string;
    decisionNote: string | null;
    createdAt: string;
  } | null;
}

export interface MyLeave {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  status: string;
  reason: string | null;
  decidedBy: string | null;
  createdAt: string;
}

export interface MyClaim {
  id: string;
  category: string;
  claimDate: string;
  amountClaimed: string;
  amountApproved: string | null;
  description: string;
  status: string;
  /** The sentence an employee reads instead of paymentRoute + payoutStatus. */
  whereTheMoneyIs: string;
  /** YYYY-MM of the payroll it is (or was) paid with, when routed to payroll. */
  payrollPeriod: string | null;
  attachments: { id: string; fileName: string; mimeType: string; fileSize: number }[];
  submittedAt: string;
  createdAt: string;
}

export interface MyPayslipSummary {
  runId: string;
  period: string;
  runStatus: string;
  paymentDate: string | null;
  grossPay: string;
  netPay: string;
}

export interface MyPayslip extends MyPayslipSummary {
  staffId: string;
  fullName: string;
  earnings: Record<string, string | null>;
  deductions: Record<string, string | null>;
  employer: Record<string, string | null>;
  workedDays: string | null;
  unpaidDays: string | null;
}

const MY = ['my-kuwick'];

export function useMyProfile() {
  return useQuery({ queryKey: [...MY, 'profile'], queryFn: () => apiClient.get<MyProfile>('/me') });
}

export function useMyHome() {
  return useQuery({
    queryKey: [...MY, 'home'],
    queryFn: () => apiClient.get<MyHome>('/me/home'),
    // A clock button that reads "clock in" after somebody clocked in is worse
    // than no clock button, so this stays fresh while the tab is open.
    refetchOnWindowFocus: true,
  });
}

export function useMySchedule(from: string, to: string) {
  return useQuery({
    queryKey: [...MY, 'schedule', from, to],
    queryFn: () => apiClient.get<MySchedule>(`/me/schedule?from=${from}&to=${to}`),
  });
}

export function useMyAttendance(from: string, to: string) {
  return useQuery({
    queryKey: [...MY, 'attendance', from, to],
    queryFn: () => apiClient.get<MyAttendanceDay[]>(`/me/attendance?from=${from}&to=${to}`),
  });
}

export function useMyLeave() {
  return useQuery({ queryKey: [...MY, 'leave'], queryFn: () => apiClient.get<MyLeave[]>('/me/leave') });
}

export function useMyClaims() {
  return useQuery({ queryKey: [...MY, 'claims'], queryFn: () => apiClient.get<MyClaim[]>('/me/claims') });
}

export function useMyPayslips() {
  return useQuery({
    queryKey: [...MY, 'payslips'],
    queryFn: () => apiClient.get<MyPayslipSummary[]>('/me/payslips'),
  });
}

export function useMyPayslip(runId: string | undefined) {
  return useQuery({
    queryKey: [...MY, 'payslip', runId],
    queryFn: () => apiClient.get<MyPayslip>(`/me/payslips/${runId}`),
    enabled: Boolean(runId),
  });
}

/** Everything under /me shares a cache key, so one write refreshes the lot. */
export function useMyLeaveBalances() {
  return useQuery({
    queryKey: [...MY, 'leave-balances'],
    queryFn: () => apiClient.get<MyLeaveBalances>('/me/leave/balances'),
  });
}

/** What a request would take, as the dates are typed. Nothing is saved. */
export function useMyLeavePreview(params: { leaveType: string; startDate: string; endDate: string; halfDay: boolean } | null) {
  const query = params
    ? `leaveType=${encodeURIComponent(params.leaveType)}&startDate=${params.startDate}&endDate=${params.endDate}&halfDay=${params.halfDay}`
    : '';
  return useQuery({
    queryKey: [...MY, 'leave-preview', query],
    queryFn: () => apiClient.get<MyLeavePreview>(`/me/leave/preview?${query}`),
    enabled: Boolean(params),
    placeholderData: (previous) => previous,
  });
}

export function useMyBenefits() {
  return useQuery({ queryKey: [...MY, 'benefits'], queryFn: () => apiClient.get<MyBenefits>('/me/benefits') });
}

/** The PDF of one PAID month — the same document HR issues, fetched with the employee's own token. */
export function myPayslipPdfPath(runId: string): string {
  return `/me/payslips/${runId}/pdf`;
}

function useMyMutation<TBody, TResult>(fn: (body: TBody) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MY }),
  });
}

export function useClockSelf() {
  return useMyMutation((body: { clinicId?: string }) => apiClient.post('/me/attendance/clock', body));
}

export function useRequestCorrection() {
  return useMyMutation(
    (body: {
      attendanceRecordId: string;
      requestedClockInAt?: string;
      requestedClockOutAt?: string;
      reason: string;
    }) => apiClient.post('/me/attendance/corrections', body),
  );
}

export function useRequestLeave() {
  return useMyMutation(
    (body: { leaveType: string; startDate: string; endDate: string; reason?: string; halfDay?: boolean }) =>
      apiClient.post('/me/leave', body),
  );
}

export function useSubmitClaim() {
  return useMyMutation(
    (body: {
      category: string;
      amountClaimed: string;
      claimDate: string;
      description: string;
    }) => apiClient.post<{ id: string }>('/me/claims', body),
  );
}

export function useAttachReceipt() {
  return useMyMutation(
    (body: { claimId: string; fileName: string; filePath: string; mimeType: string; fileSize: number }) =>
      apiClient.post(`/me/claims/${body.claimId}/receipts`, {
        fileName: body.fileName,
        filePath: body.filePath,
        mimeType: body.mimeType,
        fileSize: body.fileSize,
      }),
  );
}
