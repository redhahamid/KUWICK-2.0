import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';

export type ProviderShiftType = 'WORKING' | 'OFF' | 'LEAVE' | 'BLOCKED' | 'LOCUM';
export type ProviderScheduleMode = 'ROSTER_LINKED' | 'FIXED_WEEKLY';

export interface RosterShift {
  id: string;
  shiftType: ProviderShiftType;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  bookableStartTime: string | null;
  bookableEndTime: string | null;
  note: string | null;
}

export interface RosterCell {
  date: string;
  shifts: RosterShift[];
  leave: { leaveType: string } | null;
}

export interface RosterRow {
  staffId: string;
  fullName: string;
  /** The mode governing the first day of the viewed month (§18b — effective-dated). */
  scheduleMode: ProviderScheduleMode;
  /** The next scheduled mode change on or after that day, if one exists. */
  modeChange: { mode: ProviderScheduleMode; effectiveFrom: string } | null;
  calendarColor: string | null;
  cells: Record<string, RosterCell>;
}

export interface RosterMatrix {
  clinicId: string;
  month: string;
  timeZone: string;
  dates: string[];
  closedDates: Record<string, string | null>;
  providers: RosterRow[];
}

export interface RangeShift {
  id: string;
  staffId: string;
  shiftType: ProviderShiftType;
  startsAt: string;
  endsAt: string;
  bookableStartsAt: string | null;
  bookableEndsAt: string | null;
  note: string | null;
}

export function useRosterMonth(clinicId: string | undefined, month: string) {
  return useQuery({
    queryKey: ['roster-month', clinicId, month],
    queryFn: () =>
      apiClient.get<RosterMatrix>(`/provider-shifts/month?clinicId=${clinicId}&month=${month}`),
    enabled: Boolean(clinicId),
    placeholderData: (previous) => previous,
  });
}

/** The working-hours shading behind the calendar, for a visible date range. */
export function useRosterRange(clinicId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ['roster-range', clinicId, from, to],
    queryFn: () =>
      apiClient.get<RangeShift[]>(
        `/provider-shifts/range?clinicId=${clinicId}&from=${from}&to=${to}`,
      ),
    enabled: Boolean(clinicId),
    placeholderData: (previous) => previous,
  });
}

function invalidateRoster(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['roster-month'] });
  queryClient.invalidateQueries({ queryKey: ['roster-range'] });
  // The roster decides availability, so the slot grid is stale the moment it
  // changes. Missing this is how a receptionist is offered a slot that has
  // just been rostered away.
  queryClient.invalidateQueries({ queryKey: ['availability'] });
}

export interface CreateShiftInput {
  clinicId: string;
  staffId: string;
  dates: string[];
  startTime: string;
  endTime: string;
  shiftType?: ProviderShiftType;
  bookableStartTime?: string;
  bookableEndTime?: string;
  note?: string;
  replaceExisting?: boolean;
}

export function useCreateShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateShiftInput) =>
      apiClient.post<{ created: number }>('/provider-shifts', input),
    onSuccess: () => invalidateRoster(queryClient),
  });
}

export function useUpdateShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      apiClient.patch(`/provider-shifts/${id}`, body),
    onSuccess: () => invalidateRoster(queryClient),
  });
}

export function useRemoveShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ removed: boolean; orphanedAppointments: number }>(
        `/provider-shifts/${id}`,
      ),
    onSuccess: () => invalidateRoster(queryClient),
  });
}

export function useCopyRosterMonth() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { clinicId: string; fromMonth: string; toMonth: string; staffIds?: string[] }) =>
      apiClient.post<{ created: number; skipped: number }>('/provider-shifts/copy-month', input),
    onSuccess: () => invalidateRoster(queryClient),
  });
}

export interface SetScheduleModeResult {
  staffId: string;
  fullName: string;
  mode: ProviderScheduleMode;
  effectiveFrom: string;
  /** What actually governs today, per the server's resolver. */
  modeToday: ProviderScheduleMode;
  /** Every scheduled change still ahead, in order. */
  upcoming: { mode: ProviderScheduleMode; effectiveFrom: string }[];
}

export function useSetScheduleMode() {
  const queryClient = useQueryClient();
  return useMutation({
    // A mode switch is a DECISION WITH A DATE (§18b): today or later, never
    // the past. The server writes a period row; nothing flips on the day.
    mutationFn: (input: { staffId: string; mode: ProviderScheduleMode; effectiveFrom: string }) =>
      apiClient.put<SetScheduleModeResult>('/provider-shifts/schedule-mode', input),
    onSuccess: () => invalidateRoster(queryClient),
  });
}
