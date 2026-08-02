import { Staff } from '../hr/types';
import { Clinic, Patient } from '../core/types';
import { Item } from '../inventory/types';

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

export type UpdateServiceDto = Partial<CreateServiceDto> & { active?: boolean };

// Not a DB enum on the backend (fields are stored as JSON) — kept as a
// union here for the same reason. Mirrors the owner's audited kuwick.com
// "Result Form Builder" type picker; grids/rating/linear-scale/file-
// upload/title-description are deferred (see form-field.dto.ts).
export type FormFieldType = 'TEXT' | 'NUMBER' | 'TEXTAREA' | 'RADIO' | 'CHECKBOX' | 'SELECT' | 'DATE' | 'TIME';

export interface FormField {
  id: string;
  label: string;
  type: FormFieldType;
  unit?: string;
  options?: string[];
  normalRangeMin?: number;
  normalRangeMax?: number;
  required?: boolean;
}

export interface FormTemplate {
  id: string;
  name: string;
  serviceCatalogId: string | null;
  fields: FormField[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFormTemplateDto {
  name: string;
  serviceCatalogId?: string;
  fields: FormField[];
}

export interface UpdateFormTemplateDto {
  name?: string;
  serviceCatalogId?: string;
  fields?: FormField[];
  active?: boolean;
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
  panelClinicId: string | null;
  presentingComplaint: string | null;
  checkInAt: string;
  checkOutAt: string | null;
  staff?: Staff;
  patient?: Patient;
  clinic?: Clinic;
  queueTicket?: QueueTicket | null;
}

// D-044 — standalone Visit creation (Patient Dashboard's "New Visit"),
// independent of the Queue flow.
export interface CreateVisitDto {
  clinicId: string;
  patientId: string;
  staffId: string;
  billingType: string;
  panelClinicId?: string;
  presentingComplaint?: string;
}

// D-041 — how a panel's per-claim fee is expressed.
export type PanelClaimFeeType = 'PERCENT' | 'AMOUNT';

export interface PanelClinic {
  id: string;
  tenantId: string;
  name: string;
  code: string | null;
  limitAmount: string | null;
  // D-041 — the panel's payment term in days (drives overdue judgement).
  paymentTermDays: number | null;
  // D-041 — per-panel claim fee (% of claimed or flat RM); null = no fee.
  claimFeeType: PanelClaimFeeType | null;
  claimFeeValue: string | null;
  active: boolean;
}

export interface CreatePanelClinicDto {
  name: string;
  code?: string;
  limitAmount?: number;
  paymentTermDays?: number;
  claimFeeType?: PanelClaimFeeType;
  claimFeeValue?: number;
}

export type UpdatePanelClinicDto = Partial<CreatePanelClinicDto> & { active?: boolean };

// Phase A8 — per-panel negotiated rate / non-coverage rule for a
// medication/vaccine/consumable (Item) or a service/procedure
// (ServiceCatalog). Exactly one of itemId/serviceCatalogId is set.
export interface PanelPriceOverride {
  id: string;
  panelClinicId: string;
  itemId: string | null;
  serviceCatalogId: string | null;
  overridePrice: string;
  item?: Item;
  serviceCatalog?: Service;
  createdAt: string;
}

export interface CreatePanelPriceOverrideDto {
  itemId?: string;
  serviceCatalogId?: string;
  overridePrice: number;
}

export interface PanelExclusion {
  id: string;
  panelClinicId: string;
  itemId: string | null;
  serviceCatalogId: string | null;
  reason: string | null;
  item?: Item;
  serviceCatalog?: Service;
  createdAt: string;
}

export interface CreatePanelExclusionDto {
  itemId?: string;
  serviceCatalogId?: string;
  reason?: string;
}

// Queue overhaul (D-038) — kuwick.com's real 4-stream numbering:
// A=appointment, C=OTC, W=walk-in, E=emergency.
export type QueueType = 'APPOINTMENT' | 'OTC' | 'WALK_IN' | 'EMERGENCY';

export interface Room {
  id: string;
  clinicId: string;
  name: string;
  active: boolean;
}

export interface CreateRoomDto {
  clinicId: string;
  name: string;
}

export interface QueueDisplayConfig {
  clinicId: string;
  youtubeUrl: string | null;
  runningText: string | null;
  voiceName: string | null;
  voiceRate: number;
  voicePitch: number;
  voiceVolume: number;
}

export type UpdateQueueDisplayConfigDto = Partial<{
  youtubeUrl: string;
  runningText: string;
  voiceName: string;
  voiceRate: number;
  voicePitch: number;
  voiceVolume: number;
}>;

export interface QueueTicket {
  id: string;
  tenantId: string;
  clinicId: string;
  visitId: string;
  ticketNumber: number;
  // "W001"/"A003"/... — null only for tickets created before D-038.
  displayNumber: string | null;
  queueType: QueueType;
  status: QueueTicketStatus;
  location: string | null;
  roomId: string | null;
  room?: Room | null;
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
  queueType?: QueueType;
  panelClinicId?: string;
  presentingComplaint?: string;
}

// Document builder (D-040) — a clinic's own document templates with
// {{merge.field}} placeholders.
export interface CustomDocumentTemplate {
  id: string;
  name: string;
  content: string;
  active: boolean;
  sourceDefaultId: string | null;
}

export interface CreateDocumentTemplateDto {
  name: string;
  content: string;
}

export type UpdateDocumentTemplateDto = Partial<CreateDocumentTemplateDto> & { active?: boolean };

// What the unauthenticated waiting-room monitor endpoint returns —
// numbers and room names only, never patient PII.
export interface PublicQueueTicket {
  id: string;
  displayNumber: string;
  queueType: QueueType;
  status: QueueTicketStatus;
  calledAt: string | null;
  roomName: string | null;
}

export interface PublicQueueMonitorData {
  clinic: { id: string; name: string };
  config: QueueDisplayConfig;
  tickets: PublicQueueTicket[];
}

export type NoteLanguage = 'EN' | 'MS';

// C0 (D-051) — clinical-record integrity.
export type ClinicalNoteType = 'DOCTOR_NARRATIVE' | 'STAFF_REMARK';
export type ClinicalNoteStatus = 'DRAFT' | 'SIGNED';
export type ClinicalNoteEntryType = 'STANDARD' | 'AMENDMENT';
export type ObservationSource = 'MANUAL' | 'DEVICE' | 'IMPORTED';

export interface StaffRef {
  id: string;
  fullName: string;
  role: string;
}

export interface ClinicalNote {
  id: string;
  tenantId: string;
  clinicId: string | null;
  visitId: string;
  notes: string | null;
  noteLanguage: NoteLanguage;
  createdAt: string;
  updatedAt: string;

  // Authorship + signing (C0). Snapshots are the historical truth — the
  // *Ref objects only exist for convenience and may reflect a later rename.
  noteType: ClinicalNoteType;
  status: ClinicalNoteStatus;
  entryType: ClinicalNoteEntryType;
  version: number;
  authorStaffId: string | null;
  authorNameSnapshot: string | null;
  authorRoleSnapshot: string | null;
  authorDesignationSnapshot: string | null;
  signedByStaffId: string | null;
  signerNameSnapshot: string | null;
  signerRoleSnapshot: string | null;
  signerDesignationSnapshot: string | null;
  signedAt: string | null;
  clinicalEntryAt: string | null;
  lateEntryReason: string | null;
  supersedesNoteId: string | null;
  amendmentReason: string | null;
  legacyAuthorUnknown: boolean;
  author?: StaffRef | null;
  signedBy?: StaffRef | null;
  hasAmendment?: boolean;
  isLateEntry?: boolean;

  // Frozen legacy vitals — live vitals moved to VisitObservation in C0.
  // Still returned so historical notes keep displaying what they recorded.
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
  bmi: number | null;
}

// Vitals/anthropometry/point-of-care with their own recorder attribution.
export interface VisitObservation {
  id: string;
  tenantId: string;
  clinicId: string;
  visitId: string;
  recordedByStaffId: string | null;
  recorderNameSnapshot: string | null;
  recorderRoleSnapshot: string | null;
  recorderDesignationSnapshot: string | null;
  recordedAt: string;
  updatedByStaffId: string | null;
  updaterNameSnapshot: string | null;
  updaterRoleSnapshot: string | null;
  updatedAt: string;
  version: number;
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
  bmi: number | null;
  source: ObservationSource;
  legacyRecorderUnknown: boolean;
  recordedBy?: StaffRef | null;
  updatedBy?: StaffRef | null;
}

export interface RecordObservationDto {
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
  source?: ObservationSource;
}

export interface CorrectObservationDto extends RecordObservationDto {
  expectedVersion: number;
  correctionReason: string;
}

export interface ClinicalNoteRevision {
  id: string;
  noteId: string;
  versionNo: number;
  contentSnapshot: Record<string, unknown>;
  contentHash: string | null;
  hashSchemaVersion: number | null;
  changeType: 'CREATED' | 'UPDATED' | 'SIGNED';
  previousStatus: ClinicalNoteStatus | null;
  newStatus: ClinicalNoteStatus;
  editedByStaffId: string | null;
  editorNameSnapshot: string | null;
  editorRoleSnapshot: string | null;
  editedAt: string;
  reason: string | null;
}

export interface SignClinicalNoteDto {
  expectedVersion: number;
}

export interface AmendClinicalNoteDto {
  amendmentReason: string;
  notes?: string;
  noteLanguage?: NoteLanguage;
}

// Narrative only — vitals live on VisitObservation now, and author/signer
// are never sent by the client (the server takes them from the session).
export interface UpsertClinicalNoteDto {
  notes?: string;
  noteLanguage?: NoteLanguage;
  noteType?: ClinicalNoteType;
  clinicalEntryAt?: string;
  lateEntryReason?: string;
  expectedVersion?: number;
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

// G2a (D-059) — null means "priority not recorded", which is the honest state
// for every diagnosis recorded before G2a. It is never treated as SECONDARY.
export type DiagnosisPriority = 'PRIMARY' | 'SECONDARY';

// G2 closure (D-061) — a saved diagnosis is never deleted; it is removed from
// the active record with an audited reason and stays queryable for history.
export type DiagnosisRecordStatus = 'ACTIVE' | 'REMOVED_IN_ERROR';

export interface Diagnosis {
  id: string;
  tenantId: string;
  visitId: string;
  diagnosisCatalogId: string | null;
  icd10Code: string | null;
  name: string;
  createdAt: string;
  priority: DiagnosisPriority | null;
  // Attribution is server-derived; the client only ever reads these.
  addedByStaffId: string | null;
  addedByNameSnapshot: string | null;
  addedByRoleSnapshot: string | null;
  addedAt: string;
  legacyAttributionUnknown: boolean;
  // G2 closure (D-061) — removal audit. All server-written; the client reads.
  recordStatus: DiagnosisRecordStatus;
  removedAt: string | null;
  removedByStaffId: string | null;
  removedByNameSnapshot: string | null;
  removedByRoleSnapshot: string | null;
  removalReason: string | null;
  version: number;
}

export interface AddDiagnosisDto {
  visitId: string;
  diagnosisCatalogId?: string;
  name?: string;
  icd10Code?: string;
  priority?: DiagnosisPriority;
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
  formTemplateId: string | null;
  formData: Record<string, unknown> | null;
  visit?: Visit;
  requestedBy?: Staff;
  // G2b — read-only counts from the list endpoint, so the section can show an
  // attachments indicator and whether the order has reached an invoice
  // without inventing either.
  _count?: { attachments: number; invoiceLines: number };
}

export interface CreateOrderServiceDto {
  visitId: string;
  serviceCatalogId: string;
  instruction?: string;
}

export interface CompleteOrderServiceDto {
  result?: string;
  formTemplateId?: string;
  formData?: Record<string, unknown>;
}

export interface CancelOrderServiceDto {
  cancelReason?: string;
}

export interface Attachment {
  id: string;
  orderServiceId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedByStaffId: string;
  createdAt: string;
}

// D-044 — free-standing visit-level uploads (photos, scanned results,
// PDFs), distinct from Attachment (scoped to a single order/procedure).
export interface VisitAttachment {
  id: string;
  visitId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedByStaffId: string | null;
  uploadedBy?: Staff | null;
  createdAt: string;
}

export type DocumentType = 'MC' | 'REFERRAL' | 'MEMO' | 'QUARANTINE' | 'CUSTOM';

export interface ClinicalDocument {
  id: string;
  visitId: string;
  type: DocumentType;
  // Display name for CUSTOM documents (the template's name, D-040).
  title: string | null;
  content: string;
  issuedByStaffId: string;
  issuedDate: string;
  startDate: string | null;
  endDate: string | null;
  diagnosisText: string | null;
  referredTo: string | null;
  signedAt: string | null;
  signedByStaffId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDocumentDto {
  visitId: string;
  type: DocumentType;
  title?: string;
  content: string;
  issuedByStaffId?: string;
  issuedDate?: string;
  startDate?: string;
  endDate?: string;
  diagnosisText?: string;
  referredTo?: string;
}

export type InvoiceStatus = 'UNPAID' | 'PAID' | 'CANCELLED';

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  description: string;
  quantity: number;
  unitPrice: string;
  amount: string;
  sourceOrderServiceId: string | null;
  sourcePrescriptionId: string | null;
  excludedFromPanel: boolean;
  createdAt: string;
}

export interface Invoice {
  id: string;
  visitId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  totalAmount: string;
  createdByStaffId: string;
  cancelReason: string | null;
  paidAt: string | null;
  paymentMethod: string | null;
  // Phase 1e — snapshotted server-side at pay-time (InvoiceService#pay),
  // never live-recomputed afterward. 0/0 for an UNPAID invoice.
  panelCoveredAmount: string;
  patientPaidAmount: string;
  createdAt: string;
  updatedAt: string;
  lines: InvoiceLine[];
  visit?: Visit;
}

// Phase 1e (Panel Claims Core). One status lifecycle for every panel
// (D-031) — per-panel variance (AIA/MARA/etc.) is captured as data
// (submissionMethod + free batching cadence), not as a workflow fork.
export type ClaimBatchStatus = 'BATCHED' | 'SUBMITTED' | 'PARTIALLY_PAID' | 'PAID' | 'RECONCILED';
export type ClaimLineStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'DEDUCTED' | 'PAID';
export type ClaimSubmissionMethod = 'PORTAL' | 'COURIER' | 'EMAIL' | 'OTHER';

export interface ClaimBatchLine {
  id: string;
  claimBatchId: string;
  invoiceId: string;
  claimedAmount: string;
  // D-041 — the panel's add-on fee; receivable = claimed + fee.
  feeAmount: string;
  status: ClaimLineStatus;
  paidAmount: string | null;
  deductionReason: string | null;
  remarks: string | null;
  invoice: Invoice;
  createdAt: string;
}

// D-041 — the per-panel tracking row: every panel invoice auto-listed as
// UNCLAIMED once settled at the counter, then BATCHED → SUBMITTED →
// PAID/REJECTED/DEDUCTED through the claim workflow.
export type PanelTrackingStatus = 'UNCLAIMED' | 'BATCHED' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'DEDUCTED' | 'PAID';

export interface PanelClaimLineRow {
  id: string;
  claimBatchId: string | null;
  batchNumber: string | null;
  batchStatus: string | null;
  submissionReference: string | null;
  status: PanelTrackingStatus;
  serviceDate: string;
  monthKey: string;
  patientName: string;
  invoiceNumber: string;
  claimedAmount: number;
  feeAmount: number;
  claimToReceive: number;
  paidAmount: number;
  receivable: number;
  remarks: string | null;
  deductionReason: string | null;
  daysSinceSubmission: number | null;
  paymentTermDays: number | null;
  overdue: boolean;
}

export interface PanelYearlySummaryRow {
  panelClinicId: string;
  panelName: string;
  claims: number;
  claimedTotal: number;
  feeTotal: number;
  receivableTotal: number;
  paidTotal: number;
  outstandingTotal: number;
}

export interface ClaimBatch {
  id: string;
  panelClinicId: string;
  batchNumber: string;
  status: ClaimBatchStatus;
  submissionMethod: string | null;
  submissionReference: string | null;
  submittedAt: string | null;
  reconciledAt: string | null;
  createdByStaffId: string;
  lines: ClaimBatchLine[];
  createdAt: string;
  updatedAt: string;
}

export interface OutstandingClaimBatch extends ClaimBatch {
  claimedTotal: number;
  feeTotal: number;
  paidTotal: number;
  outstandingAmount: number;
  daysOutstanding: number;
  paymentTermDays: number | null;
  overdue: boolean;
  panelClinic: PanelClinic;
}

export interface CreateClaimBatchDto {
  panelClinicId: string;
  invoiceIds: string[];
  createdByStaffId: string;
}

export interface SubmitClaimBatchDto {
  submissionMethod: ClaimSubmissionMethod;
  submissionReference?: string;
}

export interface RecordClaimLinePaymentDto {
  status: Exclude<ClaimLineStatus, 'PENDING'>;
  paidAmount?: number;
  deductionReason?: string;
  remarks?: string;
}

export interface CreateInvoiceDto {
  visitId: string;
  createdByStaffId: string;
}

export interface AddInvoiceLineDto {
  description: string;
  quantity?: number;
  unitPrice: number;
  sourceOrderServiceId?: string;
  sourcePrescriptionId?: string;
}

export interface CancelInvoiceDto {
  cancelReason?: string;
}

// Cash/Card/QR/Bank Transfer are the patient-facing methods a staff member
// picks in the payment picker. PANEL is used internally for the "fully
// covered, no patient copay" settlement action — never shown as a picker
// option (see InvoiceTab's PATIENT_PAYMENT_METHOD_OPTIONS).
export type PaymentMethod = 'CASH' | 'CARD' | 'QR' | 'BANK_TRANSFER' | 'PANEL';

export interface PayInvoiceDto {
  paymentMethod: PaymentMethod;
}

export type PrescriptionStatus = 'ORDERED' | 'DISPENSED' | 'CANCELLED';
export type DosageCalcMethod = 'WEIGHT_BASED' | 'AGE_BASED' | 'MANUAL';

export interface Prescription {
  id: string;
  tenantId: string;
  visitId: string;
  itemId: string;
  quantity: number;
  amount: string;
  unit: string | null;
  frequency: string;
  durationDays: number;
  indication: string | null;
  remark: string | null;
  calcMethod: DosageCalcMethod | null;
  calcWeightKg: string | null;
  calcDoseRateMgKg: string | null;
  calcTargetDoseMg: string | null;
  status: PrescriptionStatus;
  prescribedByStaffId: string;
  prescribedAt: string;
  dispensedAt: string | null;
  cancelReason: string | null;
  item?: Item;
  // G2b — read-only, from the list endpoint's include.
  prescribedBy?: Staff;
}

export interface CreatePrescriptionDto {
  visitId: string;
  itemId: string;
  quantity: number;
  amount: number;
  unit?: string;
  frequency: string;
  durationDays: number;
  indication?: string;
  remark?: string;
  calcMethod?: DosageCalcMethod;
  calcWeightKg?: number;
  calcDoseRateMgKg?: number;
}

export interface CancelPrescriptionDto {
  cancelReason?: string;
}

export interface CopyPrescriptionsDto {
  sourceVisitId: string;
  targetVisitId: string;
}

// D-046 — one thread model backs channel chat (channelId set) and
// per-procedure chat (orderServiceId set).
export interface ChatMessage {
  id: string;
  clinicId: string;
  channelId: string | null;
  orderServiceId: string | null;
  staffId: string;
  staff?: { id: string; fullName: string };
  message: string;
  createdAt: string;
}

// D-048 — every clinic has one "General" channel plus any number of named
// team channels. latestMessage* is only present from the
// GET /clinics/:clinicId/chat-channels list endpoint (powers the unread
// badge without fetching each channel's full history).
export interface ChatChannel {
  id: string;
  clinicId: string;
  name: string;
  isGeneral: boolean;
  createdAt: string;
  latestMessageAt?: string | null;
  latestMessageStaffId?: string | null;
}
