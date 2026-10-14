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
  /** The template it was rostered from (UAT, 14 October 2026), with its copied break and night flag. */
  template?: { id: string; name: string; colour: string } | null;
  breakMinutes?: number;
  night?: boolean;
}

export interface RosterCell {
  date: string;
  shifts: RosterShift[];
  leave: { leaveType: string } | null;
}

export interface ScheduledModeChange {
  mode: ProviderScheduleMode;
  effectiveFrom: string;
}

/** The five-way split a roster is actually read along. Derived from the role. */
export type WorkforceCategory = 'DOCTOR' | 'CLINICAL' | 'ADMIN' | 'MANAGEMENT' | 'OTHER';

export const WORKFORCE_CATEGORY_LABELS: Record<WorkforceCategory, string> = {
  DOCTOR: 'Doctors',
  CLINICAL: 'Clinical',
  ADMIN: 'Admin / front desk',
  MANAGEMENT: 'Finance / management',
  OTHER: 'Other',
};

export interface RosterRow {
  staffId: string;
  fullName: string;
  /** Which part of the workforce, for the board's filter and its sections. */
  category: WorkforceCategory;
  role: string;
  /**
   * Whether appointments can be booked into this person's shifts.
   *
   * False for most of the roster now that it holds the whole workforce. The
   * board uses it to decide whether the availability apparatus — scheduling
   * mode, bookable window — belongs on the row at all: offering a receptionist
   * a "bookable hours" field would be offering a setting that governs nothing.
   */
  bookable: boolean;
  /** The mode governing the first day of the viewed month (§18b — effective-dated). */
  scheduleMode: ProviderScheduleMode;
  /** The next scheduled mode change on or after that day, if one exists. */
  modeChange: ScheduledModeChange | null;
  /** The mode governing TODAY, whatever month is on screen. */
  modeToday: ProviderScheduleMode;
  /** Every change scheduled after today, in order — the plan the dialog edits. */
  upcomingChanges: ScheduledModeChange[];
  calendarColor: string | null;
  cells: Record<string, RosterCell>;
}

export interface RosterMatrix {
  clinicId: string;
  month: string;
  timeZone: string;
  dates: string[];
  closedDates: Record<string, string | null>;
  /** Counts of the WHOLE workforce, before any filter — the chips' numbers. */
  categoryCounts: Record<WorkforceCategory, number>;
  providers: RosterRow[];
  /** The branch's week start, 0 Sunday … 6 Saturday, and opening hours. */
  weekStartDay?: number;
  openingHours?: OpeningHours | null;
}

export interface OpeningHours {
  open24Hours: boolean;
  openTime: string | null;
  closeTime: string | null;
}

export type ShiftGroup = 'DOCTOR' | 'STAFF';

/** A clinic-defined shift (UAT, 14 October 2026). */
export interface ShiftTemplate {
  id: string;
  clinicId: string | null;
  group: ShiftGroup;
  name: string;
  kind: 'WORKING' | 'OFF';
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
  night: boolean;
  colour: string;
  sortOrder: number;
  active: boolean;
  crossesMidnight: boolean;
  workedMinutes: number;
}

export type ShiftTemplateInput = Pick<ShiftTemplate, 'group' | 'name' | 'kind' | 'startTime' | 'endTime' | 'breakMinutes' | 'night' | 'colour' | 'clinicId'> & {
  sortOrder?: number;
};

/** The roster sees a group's shifts for every branch and this one; settings sees them all. */
export function useShiftTemplates(params: { group?: ShiftGroup; clinicId?: string; includeRetired?: boolean } = {}) {
  const query = new URLSearchParams();
  if (params.group) query.set('group', params.group);
  if (params.clinicId) query.set('clinicId', params.clinicId);
  if (params.includeRetired) query.set('includeRetired', 'true');
  return useQuery({
    queryKey: ['shift-templates', params.group ?? 'ALL', params.clinicId ?? 'ALL', Boolean(params.includeRetired)],
    queryFn: () => apiClient.get<ShiftTemplate[]>(`/workforce/shift-templates${query.size ? `?${query}` : ''}`),
  });
}

export function useSaveShiftTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ShiftTemplateInput & { id?: string }) =>
      id
        ? apiClient.put<ShiftTemplate>(`/workforce/shift-templates/${id}`, body)
        : apiClient.post<ShiftTemplate>('/workforce/shift-templates', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shift-templates'] }),
  });
}

export function useRemoveShiftTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ id: string; retired: boolean; rosteredShifts: number }>(`/workforce/shift-templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-templates'] });
      invalidateRoster(queryClient);
    },
  });
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

export function useRosterMonth(
  clinicId: string | undefined,
  month: string,
  category?: WorkforceCategory,
) {
  return useQuery({
    queryKey: ['roster-month', clinicId, month, category ?? 'ALL'],
    queryFn: () =>
      apiClient.get<RosterMatrix>(
        `/provider-shifts/month?clinicId=${clinicId}&month=${month}${category ? `&category=${category}` : ''}`,
      ),
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
  templateId?: string;
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
  /** False when the decision decided nothing and was consolidated away. */
  applied: boolean;
  /** True when re-deciding a scheduled date back to the standing mode withdrew that change. */
  withdrew: boolean;
  /** Later scheduled decisions this one made redundant (removed, never past ones). */
  removedRedundant: { mode: ProviderScheduleMode; effectiveFrom: string }[];
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
