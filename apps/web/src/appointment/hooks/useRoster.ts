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
  scheduleMode: ProviderScheduleMode;
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

export function useSetScheduleMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { staffId: string; mode: ProviderScheduleMode }) =>
      apiClient.put('/provider-shifts/schedule-mode', input),
    onSuccess: () => invalidateRoster(queryClient),
  });
}
