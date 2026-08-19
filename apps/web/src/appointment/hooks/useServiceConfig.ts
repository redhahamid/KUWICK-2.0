import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';

export type ServicePriceDisplay = 'HIDDEN' | 'EXACT' | 'FROM';
export type ServiceBookingPaymentRule = 'NONE' | 'DEPOSIT' | 'FULL';
export type BookingFieldType =
  | 'SHORT_TEXT'
  | 'LONG_TEXT'
  | 'YES_NO'
  | 'SINGLE_CHOICE'
  | 'MULTI_CHOICE'
  | 'NUMBER'
  | 'DATE';

export interface ServiceListRow {
  id: string;
  name: string;
  category: string | null;
  active: boolean;
  bookable: boolean;
  durationMinutesDefault: number;
  slotIntervalMinutes: number | null;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  concurrentLimit: number | null;
  requiresApproval: boolean;
  price: string;
  priceDisplay: ServicePriceDisplay;
  bookingFee: string;
  bookingPaymentRule: ServiceBookingPaymentRule;
  depositAmount: string;
  bookingSlug: string | null;
  providers: { id: string; fullName: string }[];
}

export interface BookingFormFieldRow {
  id?: string;
  label: string;
  helpText: string | null;
  fieldType: BookingFieldType;
  required: boolean;
  active: boolean;
  sortOrder: number;
  options: string[];
}

export interface ServiceDetail extends Omit<ServiceListRow, 'providers'> {
  code: string | null;
  orderType: string;
  bookingDescription: string | null;
  bookingPhotoUrl: string | null;
  minimumNoticeMinutes: number | null;
  maxAdvanceDays: number | null;
  bookableHours: { dayOfWeek: number; startTime: string; endTime: string }[];
  providerStaffIds: string[];
  formFields: BookingFormFieldRow[];
  preInstructions: string | null;
  postInstructions: string | null;
  reminderRules: { id: string; offsetMinutes: number; channel: string }[];
}

export function useAppointmentServices(params: { bookableOnly?: boolean; search?: string } = {}) {
  const query = new URLSearchParams();
  if (params.bookableOnly) query.set('bookableOnly', 'true');
  if (params.search) query.set('search', params.search);
  return useQuery({
    queryKey: ['appointment-services', params],
    queryFn: () => apiClient.get<ServiceListRow[]>(`/appointment-services?${query.toString()}`),
    placeholderData: (previous) => previous,
  });
}

export function useServiceDetail(serviceId: string | undefined) {
  return useQuery({
    queryKey: ['appointment-service', serviceId],
    queryFn: () => apiClient.get<ServiceDetail>(`/appointment-services/${serviceId}`),
    enabled: Boolean(serviceId),
  });
}

export function useUpdateServiceConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      apiClient.patch<ServiceDetail>(`/appointment-services/${id}`, body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['appointment-services'] });
      queryClient.invalidateQueries({ queryKey: ['appointment-service', variables.id] });
      // Duration, buffers and eligibility all change what the slot grid says.
      queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}
