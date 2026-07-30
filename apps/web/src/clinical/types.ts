import { Staff } from '../hr/types';
import { Patient } from '../core/types';

export type ServiceOrderType = 'STANDARD_SERVICE' | 'TASK_ORDER';

export interface Service {
  id: string;
  tenantId: string;
  name: string;
  code: string | null;
  category: string | null;
  orderType: ServiceOrderType;
  durationMinutesDefault: number;
  price: string;
  active: boolean;
}

export interface CreateServiceDto {
  name: string;
  code?: string;
  category?: string;
  orderType?: ServiceOrderType;
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

export type DiagnosisCategory = 'CUSTOM' | 'SUMMARIZE' | 'FULL';

export interface DiagnosisCatalogEntry {
  id: string;
  tenantId: string;
  icd10Code: string | null;
  name: string;
  category: DiagnosisCategory;
  active: boolean;
}

export interface Diagnosis {
  id: string;
  tenantId: string;
  visitId: string;
  diagnosisCatalogId: string | null;
  icd10Code: string | null;
  name: string;
  createdAt: string;
}

export interface AddDiagnosisDto {
  visitId: string;
  diagnosisCatalogId?: string;
  name?: string;
  icd10Code?: string;
}

export interface DiagnosisCatalogCounts {
  summarize: { total: number; active: number };
  full: { total: number; active: number };
}

export interface CreateCustomDiagnosisDto {
  name: string;
  icd10Code?: string;
}

export type OrderServiceStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface OrderService {
  id: string;
  tenantId: string;
  clinicId: string;
  visitId: string;
  serviceCatalogId: string;
  code: string | null;
  procedureName: string;
  orderType: ServiceOrderType;
  instruction: string | null;
  result: string | null;
  status: OrderServiceStatus;
  requestedByStaffId: string;
  requestedAt: string;
  completedAt: string | null;
  cancelReason: string | null;
  visit?: Visit;
  requestedBy?: Staff;
}

export interface CreateOrderServiceDto {
  visitId: string;
  serviceCatalogId: string;
  instruction?: string;
}

export interface CompleteOrderServiceDto {
  result?: string;
}

export interface CancelOrderServiceDto {
  cancelReason?: string;
}
