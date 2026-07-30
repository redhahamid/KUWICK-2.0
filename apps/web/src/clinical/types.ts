import { Staff } from '../hr/types';
import { Patient } from '../core/types';

export interface Service {
  id: string;
  tenantId: string;
  name: string;
  durationMinutesDefault: number;
  price: string;
  active: boolean;
}

export interface CreateServiceDto {
  name: string;
  durationMinutesDefault: number;
  price?: number;
}

export type QueueTicketStatus = 'WAITING' | 'IN_CONSULTATION' | 'DISPENSARY_PAYMENT' | 'COMPLETED' | 'CANCELLED';

export interface Visit {
  id: string;
  tenantId: string;
  clinicId: string;
  patientId: string;
  staffId: string;
  visitNumber: string;
  billingType: string;
  presentingComplaint: string | null;
  checkInAt: string;
  checkOutAt: string | null;
  staff?: Staff;
  patient?: Patient;
  queueTicket?: QueueTicket | null;
}

export interface QueueTicket {
  id: string;
  tenantId: string;
  clinicId: string;
  visitId: string;
  ticketNumber: number;
  status: QueueTicketStatus;
  location: string | null;
  calledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  visit: Visit;
}

export interface AddToQueueDto {
  clinicId: string;
  patientId: string;
  staffId: string;
  billingType: string;
  presentingComplaint?: string;
}
