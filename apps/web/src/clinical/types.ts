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

export type NoteLanguage = 'EN' | 'MS';

export interface ClinicalNote {
  id: string;
  tenantId: string;
  visitId: string;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  pulse: number | null;
  temperature: string | null;
  spo2: number | null;
  respRate: number | null;
  painScore: number | null;
  weight: string | null;
  height: string | null;
  headCircumference: string | null;
  glucose: string | null;
  notes: string | null;
  noteLanguage: NoteLanguage;
  bmi: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertClinicalNoteDto {
  bpSystolic?: number;
  bpDiastolic?: number;
  pulse?: number;
  temperature?: number;
  spo2?: number;
  respRate?: number;
  painScore?: number;
  weight?: number;
  height?: number;
  headCircumference?: number;
  glucose?: number;
  notes?: string;
  noteLanguage?: NoteLanguage;
}

export interface DiagnosisCatalogEntry {
  id: string;
  tenantId: string;
  code: string | null;
  name: string;
  active: boolean;
}

export interface Diagnosis {
  id: string;
  tenantId: string;
  visitId: string;
  diagnosisCatalogId: string | null;
  code: string | null;
  name: string;
  createdAt: string;
}

export interface AddDiagnosisDto {
  visitId: string;
  diagnosisCatalogId?: string;
  name?: string;
  code?: string;
}
