/**
 * The admin programme's API types.
 *
 * Hand-written rather than generated, matching the convention of every other
 * module here. Where a field can legitimately be NULL, the type says so — the
 * distinction between "not computed" and "zero" runs through the whole of this
 * programme, and a type that flattens it to `number` would let a screen render
 * a missing EPF contribution as RM0.00.
 */

// --- Finance ---------------------------------------------------------------

export type PaymentTender = 'CASH' | 'CARD' | 'QR' | 'EWALLET' | 'BANK_TRANSFER' | 'CHEQUE' | 'PANEL' | 'OTHER';
export type PaymentKind = 'PAYMENT' | 'REFUND';

export interface PaymentRow {
  id: string;
  kind: PaymentKind;
  tender: PaymentTender;
  methodLabel: string | null;
  amount: number;
  receivedAt: string;
  referenceNo: string | null;
  receivedBy: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  notes: string | null;
}

export interface InvoicePosition {
  invoice: {
    id: string;
    invoiceNumber: string;
    status: string;
    totalAmount: number;
    taxAmount: number;
    patientResponsibility: number | null;
    panelResponsibility: number | null;
    createdAt: string;
    paidAt: string | null;
  };
  payments: PaymentRow[];
  responsibilityResolved: boolean;
  netReceived: number;
  credited: number;
  balance: number | null;
  overpaid: number;
  settled: boolean;
}

export interface DayEndView {
  clinicId: string;
  businessDate: string;
  status: 'OPEN' | 'COUNTED' | 'CLOSED';
  frozen: boolean;
  expected: { cash: number; card: number; qr: number; other: number; total: number };
  counted: { cash: number | null; card: number | null; qr: number | null; other: number | null; total: number | null };
  variance: number | null;
  varianceReason: string | null;
  refunds: number;
  paymentCount: number;
  operational: {
    invoiceCount: number;
    visitCount: number;
    panelInvoiceCount: number;
    billed: number;
    tax: number;
    panelPortion: number;
    patientPortion: number;
  } | null;
  countedBy: string | null;
  countedAt: string | null;
  closedBy: string | null;
  closedAt: string | null;
  reopenedBy: string | null;
  reopenReason: string | null;
  reopenCount: number;
  payments: {
    id: string;
    kind: PaymentKind;
    tender: PaymentTender;
    methodLabel: string | null;
    amount: number;
    receivedAt: string;
    referenceNo: string | null;
    receivedBy: string | null;
    invoiceNumber: string | null;
    visitNumber: string | null;
    reversed: boolean;
  }[];
}

export interface OpenDayRow {
  /** One row per BRANCH per day: two branches can both have the 3rd open. */
  clinicId: string;
  clinicName: string;
  businessDate: string;
  expectedTotal: number;
  paymentCount: number;
  status: string;
}

export interface ReceivablesReport {
  asOf: string;
  totalOutstanding: number;
  invoiceCount: number;
  unresolvedCount: number;
  aging: { current: number; d31_60: number; d61_90: number; d90_plus: number };
  /** How many invoices sit in each bucket — the amount is what gets chased,
   *  the count is what decides whether the bucket is clean. */
  agingCounts: { current: number; d31_60: number; d61_90: number; d90_plus: number };
  rows: {
    invoiceId: string;
    invoiceNumber: string;
    invoiceDate: string;
    ageDays: number;
    clinicName: string | null;
    visitNumber: string | null;
    patientId: string | null;
    patientName: string | null;
    patientPhone: string | null;
    panelName: string | null;
    invoiceTotal: number;
    patientResponsibility: number;
    panelResponsibility: number | null;
    received: number;
    credited: number;
    balance: number;
    lastPaymentAt: string | null;
  }[];
}

export interface PaymentReport {
  from: string;
  to: string;
  grossReceived: number;
  refunded: number;
  netReceived: number;
  count: number;
  byTender: { tender: string; amount: number; count: number }[];
  rows: {
    id: string;
    receivedAt: string;
    kind: PaymentKind;
    tender: PaymentTender;
    methodLabel: string | null;
    amount: number;
    referenceNo: string | null;
    receivedBy: string | null;
    clinicName: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    invoiceTotal: number | null;
    patientName: string | null;
    visitNumber: string | null;
    reversed: boolean;
    reversalReason: string | null;
  }[];
}

export interface CreditNoteRow {
  id: string;
  creditNoteNumber: string;
  status: 'DRAFT' | 'ISSUED' | 'VOID';
  reason: string;
  subtotalAmount: number;
  taxAmount: number;
  totalAmount: number;
  createdAt: string;
  issuedAt: string | null;
  voidReason: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  invoiceNumber: string | null;
  invoiceTotal: number | null;
  patientName: string | null;
  visitNumber: string | null;
  lines: { id: string; description: string; quantity: number; amount: number; taxAmount: number }[];
}

export interface TaxReport {
  from: string;
  to: string;
  summary: {
    taxable: number;
    tax: number;
    grossTaxable: number;
    zeroRated: number;
    exempt: number;
    notClassified: number;
    lineCount: number;
  };
  byCode: { code: string; name: string; base: number; tax: number; lines: number }[];
  byInvoice: { invoiceId: string; invoiceNumber: string; date: string; patient: string | null; base: number; tax: number }[];
}

export interface TaxCode {
  id: string;
  code: string;
  name: string;
  treatment: 'STANDARD_RATED' | 'ZERO_RATED' | 'EXEMPT';
  active: boolean;
  currentRate: number | null;
  rates: { id: string; ratePercent: number; effectiveFrom: string; effectiveTo: string | null }[];
}

// --- Stock -----------------------------------------------------------------

export interface StockExceptions {
  clinicId: string | null;
  thresholds: { slowMovingDays: number; nearExpiryDays: number };
  negativeStock: number;
  belowMinimum: number;
  expired: number;
  nearExpiry: number;
  unconfirmedTransfers: number;
  transferDiscrepancies: number;
  openStockTakes: number;
  pendingRequests: number;
  slowMovers: number;
}

export interface StockValuation {
  costingMethod: string;
  costingNote: string;
  totalCostValue: number;
  totalPotentialSelfPayValue: number;
  potentialValueNote: string;
  itemsValued: number;
  itemsWithoutCost: number;
  byCategory: { category: string; costValue: number; potentialSelfPayValue: number; items: number; units: number }[];
  byClinic: { clinicId: string; clinicName: string; costValue: number; potentialSelfPayValue: number; items: number }[];
}

export interface StockTransferRow {
  id: string;
  transferNumber: string;
  status: 'DRAFT' | 'SENT' | 'RECEIVED' | 'RECEIVED_WITH_DISCREPANCY' | 'CANCELLED';
  fromClinicId: string;
  toClinicId: string;
  fromClinicName: string;
  toClinicName: string;
  interCompany: boolean;
  interCompanyReference: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: string;
  sentAt: string | null;
  sentBy: string | null;
  receivedAt: string | null;
  receivedBy: string | null;
  lineCount: number;
  totalSent: number;
  totalReceived: number;
  discrepancyCount: number;
  value: number;
  lines: {
    id: string;
    itemId: string;
    itemName: string;
    itemCode: string | null;
    unit: string | null;
    quantitySent: number;
    quantityReceived: number | null;
    discrepancy: number | null;
    discrepancyReason: string | null;
    unitCost: number | null;
  }[];
}

export interface StockTakeRow {
  id: string;
  takeNumber: string;
  name: string;
  status: 'DRAFT' | 'COUNTING' | 'IN_REVIEW' | 'POSTED' | 'CANCELLED';
  location: string | null;
  clinicId: string;
  clinicName: string;
  createdAt: string;
  createdBy: string;
  submittedAt: string | null;
  submittedBy: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  postedAt: string | null;
  varianceValue: number | null;
  lineCount: number;
  countedCount: number;
  completionPercent: number;
  varianceCount: number;
  counters: { staffId: string; name: string; location: string | null; completedAt: string | null }[];
}

export interface StockTakeDetail extends StockTakeRow {
  notes: string | null;
  lines: {
    id: string;
    itemId: string;
    itemName: string;
    itemCode: string | null;
    category: string | null;
    unit: string | null;
    systemQuantity: number;
    countedQuantity: number | null;
    recountQuantity: number | null;
    looseUnits: number | null;
    variance: number | null;
    varianceValue: number;
    varianceReason: string | null;
    excluded: boolean;
    unitCost: number | null;
    countedBy: string | null;
    countedAt: string | null;
  }[];
}

export interface StockMovementRow {
  id: string;
  createdAt: string;
  clinicId: string;
  clinicName: string;
  itemId: string;
  itemName: string;
  itemCode: string | null;
  unit: string | null;
  movementType: string;
  adjustmentReason: string | null;
  quantityDelta: number;
  clinicalQuantity: number | null;
  referenceType: string | null;
  referenceId: string | null;
  batchNumber: string | null;
  by: string | null;
  notes: string | null;
}

// --- Panel -----------------------------------------------------------------

export type PanelClaimStatus =
  | 'READY'
  | 'NEEDS_INFORMATION'
  | 'BATCHED'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'APPROVED'
  | 'PARTIALLY_APPROVED'
  | 'REJECTED'
  | 'RESUBMISSION_REQUIRED'
  | 'RESUBMITTED'
  | 'PAID'
  | 'PARTIALLY_PAID'
  | 'WRITTEN_OFF'
  | 'CLOSED';

export interface SubmissionQueueRow {
  claimLineId: string;
  batchId: string;
  batchNumber: string;
  panelClinicId: string;
  panelName: string;
  payerName: string | null;
  portalUrl: string | null;
  submissionMethod: string | null;
  documentRequirements: string[];
  invoiceId: string;
  invoiceNumber: string;
  visitNumber: string | null;
  serviceDate: string | null;
  clinicName: string | null;
  patientName: string | null;
  patientIdentifier: string | null;
  doctorName: string | null;
  diagnoses: string[];
  claimedAmount: number;
  feeAmount: number;
  expectedReceivable: number;
  status: PanelClaimStatus;
  ready: boolean;
  missing: string[];
}

export interface PanelReconciliation {
  asOf: string;
  totals: {
    claims: number;
    claimed: number;
    fees: number;
    expectedReceivable: number;
    approved: number;
    rejected: number;
    received: number;
    writtenOff: number;
    outstanding: number;
    /** Agreed or banked ABOVE what the fee rule expects. See financial-invariants.ts. */
    overRecovered: number;
    /** Claims whose fee treatment is unestablished — their fee is NOT in the figures above. */
    unresolvedFeeTreatment: number;
    /**
     * Rejected as a percentage of everything claimed — the clinic's own KPI,
     * computed in one cell of the workbook's summary sheet. NULL when nothing
     * has been claimed, because "0% rejected" on an empty panel reads as good.
     */
    rejectionRate: number | null;
    /** Rejections nobody has given a category. */
    uncategorisedRejections: number;
  };
  /** What the money was refused FOR, by amount. */
  rejectionReasons: { category: ClaimRejectionCategory; claims: number; amount: number }[];
  reconciles: boolean;
  aging: { current: number; d31_60: number; d61_90: number; d90_plus: number };
  byPanel: {
    panelClinicId: string;
    panelName: string;
    claims: number;
    expectedReceivable: number;
    received: number;
    outstanding: number;
    collectionRate: number | null;
    overdueClaims: number;
    averageTurnaroundDays: number | null;
  }[];
}

/**
 * A claim this panel still owes money on.
 *
 * Deliberately NOT `PanelWorkQueueRow`. The work queue is the problem queue —
 * rejected, part-approved, overdue — and a claim that was approved and will be
 * paid on terms is correctly absent from it. Somebody entering a remittance
 * advice needs the opposite list: everything with a balance, healthy or not.
 */
export interface PanelAwaitingPaymentRow {
  claimLineId: string;
  panelClinicId: string;
  panelName: string;
  panelClaimNo: string | null;
  invoiceNumber: string;
  patientName: string | null;
  serviceDate: string | null;
  status: PanelClaimStatus;
  dueDate: string | null;
  overdue: boolean;
  ageDays: number;
  claimedAmount: number;
  expectedReceivable: number;
  outstanding: number;
}

/** Why a panel refused to pay, as a countable fact beside the free text. */
export type ClaimRejectionCategory =
  | 'PATIENT_LIMIT_EXHAUSTED'
  | 'ITEM_NOT_COVERED'
  | 'PARTIALLY_COVERED'
  | 'BENEFIT_SUBLIMIT'
  | 'AUTHORISATION_PENDING'
  | 'DOCUMENTATION_INCOMPLETE'
  | 'OTHER';

export const REJECTION_CATEGORY_LABEL: Record<ClaimRejectionCategory, string> = {
  PATIENT_LIMIT_EXHAUSTED: 'Member limit exhausted',
  ITEM_NOT_COVERED: 'Item not covered',
  PARTIALLY_COVERED: 'Covered only in part',
  BENEFIT_SUBLIMIT: 'Benefit sub-limit',
  AUTHORISATION_PENDING: 'Authorisation pending',
  DOCUMENTATION_INCOMPLETE: 'Documentation incomplete',
  OTHER: 'Other',
};

export interface PanelWorkQueueRow {
  claimLineId: string;
  panelClinicId: string;
  panelName: string;
  batchNumber: string;
  panelClaimNo: string | null;
  invoiceNumber: string;
  visitNumber: string | null;
  serviceDate: string | null;
  patientName: string | null;
  patientIdentifier: string | null;
  status: PanelClaimStatus;
  submittedAt: string | null;
  dueDate: string | null;
  overdue: boolean;
  ageDays: number;
  claimedAmount: number;
  feeAmount: number;
  expectedReceivable: number;
  approvedAmount: number | null;
  rejectedAmount: number | null;
  receivedAmount: number | null;
  outstanding: number;
  rejectionReason: string | null;
  rejectionCategory: ClaimRejectionCategory | null;
  /** G-5 — already handed to the patient, and for how much. */
  chargedToPatient: number | null;
  chargedToPatientAt: string | null;
  /**
   * The re-claim deadline, on claims where re-claiming is still the route out.
   * NULL on every other status — a settled claim has no countdown.
   */
  resubmission: {
    deadline: string | null;
    daysRemaining: number | null;
    expired: boolean;
    /** FALSE when the panel's window is not configured, or there is no service date. */
    known: boolean;
    reason: string | null;
  } | null;
  responsible: string | null;
  paymentTermDays: number | null;
  resolved: boolean;
  resolvedAt: string | null;
  resolutionNote: string | null;
  /** The re-claim raised to replace this one, when there is one. */
  replacement: {
    claimLineId: string;
    batchNumber: string;
    panelClaimNo: string | null;
    status: string;
    /** When it actually went back out. NULL while only prepared. */
    resubmittedAt: string | null;
    raisedAt: string;
  } | null;
  /** The claim this one replaces, when it is itself a re-claim. */
  supersedes: {
    claimLineId: string;
    batchNumber: string;
    panelClaimNo: string | null;
    status: string;
    rejectionReason: string | null;
  } | null;
}

/**
 * How a panel's admin fee is treated in the receivable. D-041 recorded
 * `claimed + fee`; the owner superseded that on 2026-08-31 on the evidence of
 * the clinic's own workbook and bank credits. See
 * `docs/PANEL_FEE_DIRECTION_CORRECTION.md`.
 */
export type PanelFeeTreatment =
  | 'WITHHELD_FROM_CLAIM'
  | 'ADDED_TO_RECEIVABLE'
  | 'NO_FEE'
  | 'UNCONFIGURED';

export const FEE_TREATMENT_LABEL: Record<PanelFeeTreatment, string> = {
  WITHHELD_FROM_CLAIM: 'Withheld from payment',
  ADDED_TO_RECEIVABLE: 'Added to the bill',
  NO_FEE: 'No fee',
  UNCONFIGURED: 'Not established',
};

export const FEE_TREATMENT_HINT: Record<PanelFeeTreatment, string> = {
  WITHHELD_FROM_CLAIM: 'We bill the claim and bank claim − fee. The panel keeps its fee out of the payment.',
  ADDED_TO_RECEIVABLE: 'We bill claim + fee and expect all of it back.',
  NO_FEE: 'This panel charges nothing, so there is no sign to get wrong.',
  UNCONFIGURED:
    'Nobody has established the rule. The fee is applied in neither direction and every receivable on this panel excludes it.',
};

export interface PanelConfigRow {
  id: string;
  name: string;
  code: string | null;
  payerName: string | null;
  active: boolean;
  portalUrl: string | null;
  submissionMethod: string | null;
  documentRequirements: string[];
  requiresItemisation: boolean;
  resubmitAsNewClaim: boolean;
  claimNumberFormat: string | null;
  paymentTermDays: number | null;
  paymentTermMaxDays: number | null;
  paymentTermUnit: 'CALENDAR_DAYS' | 'WORKING_DAYS' | null;
  paymentTermAnchor: 'SERVICE_DATE' | 'SUBMISSION_DATE' | 'INVOICE_DATE' | null;
  paymentTermVariesByPayer: boolean;
  resubmissionWindowDays: number | null;
  feeTreatment: PanelFeeTreatment;
  /** The effective-dated history behind the current treatment, newest first. */
  feeTerms: {
    effectiveFrom: string;
    feeTreatment: PanelFeeTreatment;
    feeType: string | null;
    feeValue: number | null;
    note: string | null;
  }[];
  /** This panel's fee treatment is UNCONFIGURED — an owner has to answer it. */
  feeTreatmentUnresolved: boolean;
  claimFeeType: string | null;
  claimFeeValue: number | null;
  limitAmount: number | null;
  inventoryMarkupAmount: number | null;
  serviceMarkupAmount: number | null;
  panelShareTaxable: boolean | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  accountReference: string | null;
  notes: string | null;
  batches: number;
  visits: number;
  priceOverrides: number;
  exclusions: number;
}

export interface ClaimTimelineEvent {
  id: string;
  at: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  amount: number | null;
  reason: string | null;
  reference: string | null;
  by: string | null;
}

// --- HR --------------------------------------------------------------------

export interface WorkforceToday {
  date: string;
  clinicId: string | null;
  onDuty: { staffId: string; name: string; since: string }[];
  completed: number;
  late: number;
  onLeave: { staffId: string; name: string; leaveType: string }[];
  scheduled: { staffId: string; name: string; startAt: string; endAt: string }[];
  /** Rostered, not on leave, and no punch yet — the gap a manager walks in with. */
  notClockedIn: { staffId: string; name: string; dueAt: string; overdue: boolean }[];
  /** Who is covering what today, by the same five-way split the roster uses. */
  coverage: Record<string, number>;
  pendingLeaveApprovals: number;
  unapprovedOvertimeClaims: number;
  missingPunches: number;
  pendingClaims: number;
  pendingAttendanceCorrections: number;
}

export interface EmployeeRow {
  staffId: string;
  fullName: string;
  legacyRole: string;
  roles: (string | undefined)[];
  active: boolean;
  clinicId: string | null;
  clinicName: string | null;
  professionalType: string;
  professionalActive: boolean;
  canSignClinicalNotes: boolean;
  hasProfile: boolean;
  employeeNo: string | null;
  position: string | null;
  department: string | null;
  employmentType: string | null;
  employmentStatus: string | null;
  startDate: string | null;
  endDate: string | null;
  manager: string | null;
  leavePolicy: string | null;
  phone: string | null;
  email: string | null;
}

export interface TimesheetReport {
  from: string;
  to: string;
  staff: {
    staffId: string;
    name: string;
    daysPresent: number;
    daysAbsent: number;
    daysOnLeave: number;
    daysMissingPunch: number;
    workedMinutes: number;
    lateMinutes: number;
    lateOccasions: number;
    approvedOvertimeMinutes: number;
    unapprovedOvertimeMinutes: number;
    workedHours: number;
    approvedOvertimeHours: number;
    unapprovedOvertimeHours: number;
    days: {
      id: string;
      workDate: string;
      clockInAt: string | null;
      clockOutAt: string | null;
      status: string;
      lateMinutes: number | null;
      workedMinutes: number | null;
      overtimeMinutes: number;
      overtimeApproved: boolean;
      corrected: boolean;
      correctionReason: string | null;
    }[];
  }[];
}

export interface PayrollRunRow {
  id: string;
  period: string;
  clinicId: string | null;
  clinicName: string;
  status: 'DRAFT' | 'CALCULATED' | 'APPROVED' | 'PAID' | 'CANCELLED';
  statutoryStatus: 'CONFIGURED' | 'NOT_CONFIGURED' | 'PROVISIONAL';
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
  employerCostTotal: number;
  employeeCount: number;
  /** Derived from the exception ROWS by the API. Never a locally counted blob. */
  exceptions: PayrollExceptionGate;
  lines: number;
  adjustments: number;
  calculatedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  createdBy: string;
  paidAt: string | null;
}

/**
 * The employee's details AS AT the payroll run. Frozen on purpose — a payslip
 * must keep saying what it said after somebody's position changes.
 */
export interface PayslipEmployeeSnapshot {
  name?: string;
  employeeNo?: string | null;
  position?: string | null;
  department?: string | null;
  employmentType?: string | null;
  bankName?: string | null;
  statutoryApplicability?: { epf?: boolean; socso?: boolean; eis?: boolean; pcb?: boolean };
  /** The dated standing the line was computed on, frozen with it. */
  statutoryClassification?: { lindungParticipation?: string | null } & Record<string, unknown>;
}

export interface PayrollRunDetail {
  id: string;
  period: string;
  clinicName: string;
  status: string;
  statutoryStatus: 'CONFIGURED' | 'NOT_CONFIGURED' | 'PROVISIONAL';
  statutoryNotice: string | null;
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
  employerCostTotal: number;
  employeeCount: number;
  // No `exceptions` here on purpose — see the note in `payroll.service.ts`
  // detail(). Exception state reaches this screen only through
  // `usePayrollExceptions`, so there is no second store for it to drift from.
  calculatedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  createdBy: string;
  paidAt: string | null;
  lines: {
    id: string;
    staffId: string;
    name: string;
    basicSalary: number;
    allowances: number;
    overtimePay: number;
    incentives: number;
    bonus: number;
    grossPay: number;
    unpaidLeaveDeduction: number;
    otherDeductions: number;
    /** Frozen at the run: a payslip must keep saying what it said. */
    snapshot: PayslipEmployeeSnapshot | null;
    epfEmployee: number | null;
    epfEmployer: number | null;
    socsoEmployee: number | null;
    socsoEmployer: number | null;
    eisEmployee: number | null;
    eisEmployer: number | null;
    /** SKBBK. Employee-borne, withheld from pay; null = participation unknown. */
    lindungEmployee: number | null;
    /** HRD Corp levy — employer cost, never a deduction; null = not workable-out. */
    hrdLevy: number | null;
    pcb: number | null;
    netPay: number;
    employerCost: number;
    workedDays: number | null;
    unpaidDays: number | null;
    overtimeHours: number | null;
    breakdown: unknown;
  }[];
  adjustments: { id: string; staffName: string; description: string; amount: number; reason: string; by: string; at: string }[];
}

// ---------------------------------------------------------------------------
// PAYSLIPS FROM THE APPROVED SNAPSHOT. Composed server-side from the frozen
// record; the screen renders these fields and computes nothing. All money in
// integer cents.
// ---------------------------------------------------------------------------

export interface PayslipListEntry {
  staffId: string;
  name: string;
  netCents: number;
  grossCents: number;
  itemised: boolean;
}

export interface PayslipList {
  runId: string;
  period: string;
  snapshotVersion: number;
  versions: number;
  verdict: string;
  reopenedSinceApproval: boolean;
  payslips: PayslipListEntry[];
}

export interface PayslipStatutoryRow {
  key: string;
  label: string;
  amountCents: number | null;
  applicable: boolean;
  note: string | null;
}

export interface PayslipDoc {
  runId: string;
  period: string;
  periodLabel: string;
  runType: string;
  sequence: number;
  paymentDate: string | null;
  runStatus: string;
  statutoryStatus: string;
  clinicName: string | null;
  revision: {
    version: number;
    of: number;
    approvedAt: string;
    approvedBy: string[];
    superseded: boolean;
    reopenedSinceApproval: boolean;
  };
  verification: { verdict: string; hash: string; schemaVersion: number };
  employer: {
    name: string | null;
    registrationNo: string | null;
    epfEmployerNo: string | null;
    socsoEmployerNo: string | null;
    lhdnEmployerNo: string | null;
    addressLines: string[];
    detailsAsAt: 'CURRENT';
  };
  employee: {
    staffId: string;
    name: string;
    employeeNo: string | null;
    position: string | null;
    department: string | null;
    employmentType: string | null;
    bankName: string | null;
    epfNumber: string | null;
    socsoNumber: string | null;
    taxNumber: string | null;
    identifiersAsAt: 'CURRENT';
  };
  attendance: { workedDays: number | null; unpaidDays: number | null; overtimeHours: number | null } | null;
  itemised: boolean;
  earnings: { code: string; label: string; amountCents: number }[] | null;
  wageReductions: { code: string; label: string; amountCents: number }[] | null;
  otherDeductionLines: { code: string; label: string; amountCents: number }[] | null;
  overtimeDetail: { label: string; hours: number; hourlyRate: number; total: number }[] | null;
  statutoryDeductions: PayslipStatutoryRow[];
  employerContributions: { key: string; label: string; amountCents: number | null }[];
  figures: {
    salaryBasis: string | null;
    salaryAmountCents: number;
    grossCents: number;
    deductionCents: number;
    netCents: number;
    employerContributionCents: number;
    employerCostCents: number;
    derivedNetCents: number;
    adds: boolean;
  };
  bases: { epfCents: number; socsoCents: number; eisCents: number };
  statutoryNotes: {
    epf: string | null;
    socso: string | null;
    eis: string | null;
    lindung: string | null;
    pcb: string | null;
  } | null;
  classification: {
    epfMembership: string | null;
    lindungParticipation: string | null;
    taxResidence: string | null;
    effectiveFrom: string | null;
  } | null;
  schedules: { scheme: string; scheduleId: string | null; verification: string | null; document: string | null }[];
  ytd: {
    months: number;
    importedMonths: number;
    grossCents: number;
    epfEmployeeCents: number;
    socsoEmployeeCents: number;
    eisEmployeeCents: number;
    lindungEmployeeCents: number;
    pcbCents: number;
    zakatCents: number;
  } | null;
}

// ---------------------------------------------------------------------------
// PAYMENT PREPARATION. A document is not a transfer: only RECORDED_PAID — a
// human recording the bank reference and date — claims money moved.
// ---------------------------------------------------------------------------

export interface PaymentBatchLine {
  staffId: string;
  name: string;
  bankName: string | null;
  /** Last four digits only; the full number lives in the export permission. */
  accountEnding: string | null;
  amountCents: number;
  included: boolean;
  exclusionReason: string | null;
}

export interface PaymentStatus {
  runStatus: string;
  runPaidAt: string | null;
  mayPrepare: boolean;
  batch: {
    id: string;
    version: number;
    status: 'GENERATED' | 'DOWNLOADED' | 'RECORDED_PAID' | 'SUPERSEDED';
    snapshotVersion: number;
    totalCents: number;
    includedCount: number;
    excludedCount: number;
    createdBy: string;
    createdAt: string;
    downloadedAt: string | null;
    paidRecordedAt: string | null;
    paymentDate: string | null;
    paymentReference: string | null;
    lines: PaymentBatchLine[];
  } | null;
}

export interface IncentiveRunRow {
  id: string;
  period: string;
  clinicName: string;
  status: string;
  totalAmount: number;
  doctors: number;
  calculatedAt: string | null;
  approvedAt: string | null;
}

export interface IncentiveRunDetail extends IncentiveRunRow {
  results: {
    id: string;
    staffId: string;
    name: string;
    ruleName: string;
    ruleType: string;
    ruleVersion: number;
    basisAmount: number;
    basisCount: number;
    amount: number;
    calculation: Record<string, unknown> | null;
  }[];
}

export interface StatutoryRuleSetRow {
  id: string;
  name: string;
  jurisdiction: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  verified: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  verificationNote: string | null;
  hasEpf: boolean;
  hasSocso: boolean;
  hasEis: boolean;
  hasPcb: boolean;
  status: 'CONFIGURED' | 'NOT_CONFIGURED' | 'PROVISIONAL';
}

// --- Operations ------------------------------------------------------------

export interface OperationsOverview {
  period: { label: string; from: string; to: string };
  clinicId: string | null;
  kpis: {
    visits: number;
    patients: number;
    newPatients: number;
    returningPatients: number;
    revenue: number;
    panelPortion: number;
    averageBillPerPatient: number;
    averageWaitMinutes: number | null;
    waitSampleSize: number;
    waitCoverage: number | null;
  };
  source: { appointment: number; walkIn: number };
  byDay: { date: string; visits: number; revenue: number }[];
  byHour: { hour: number; visits: number }[];
  doctorProductivityNote: string;
  byDoctor: { staffId: string; name: string; visits: number; billedUnderDoctor: number; averageBillPerVisit: number }[];
}

export interface SegmentPl {
  configured: boolean;
  message?: string;
  from: string;
  to: string;
  profitBasis?: string;
  linesWithoutCost?: number;
  segments: {
    segmentId: string | null;
    name: string;
    code: string;
    colour: string | null;
    sortOrder: number;
    revenue: number;
    directCost: number;
    grossProfit: number;
    margin: number | null;
    lines: number;
    bills: number;
    patients: number;
  }[];
  totals: {
    revenue: number;
    cost: number;
    grossProfit: number;
    margin: number | null;
    lines: number;
    unmappedRevenue: number;
  };
}

export interface ProgrammeRow {
  id: string;
  name: string;
  code: string;
  description: string | null;
  active: boolean;
  serviceCatalogIds: string[];
  itemIds: string[];
  diagnosisCodes: string[];
  enrolments: number;
}

export interface ProgrammeDashboard {
  programme: { id: string; name: string; code: string };
  from: string;
  to: string;
  activePatients: number;
  newEnrolments: number;
  demographics: { withRecordedAge: number; averageAge: number | null };
  activity: {
    proceduresCompleted: number;
    dispensings: number;
    unitsDispensed: number;
    byItem: { itemId: string; name: string; quantity: number }[];
  };
  financials: { revenue: number; directCost: number; grossProfit: number; basis: string };
  unavailableMeasures: { measure: string; reason: string }[];
  patients: { patientId: string; name: string; gender: string | null; enrolledAt: string; lastVisitAt: string | null }[];
}

export interface MarketingAudienceResult {
  count: number;
  capability: string;
  truncated: boolean;
  patients: { patientId: string; name: string; phone: string | null; gender: string | null; age: number | null; lastVisitAt: string | null }[];
}

export interface MarketingTemplateRow {
  id: string;
  name: string;
  body: string;
  placeholders: string[];
  category: string | null;
  active: boolean;
}

export interface MarketingHistory {
  notice: string;
  rows: {
    id: string;
    at: string;
    patientName: string;
    templateName: string | null;
    audienceName: string | null;
    status: 'PREPARED' | 'OPENED';
    openedAt: string | null;
    preparedBy: string;
    body: string;
  }[];
}

// --- Profitability -----------------------------------------------------------

export type ProfitabilityKind = 'DRUG' | 'SERVICE';

export interface ProfitabilityRow {
  kind: ProfitabilityKind;
  referenceId: string | null;
  name: string;
  code: string | null;
  category: string | null;
  clinicId: string | null;
  clinicName: string | null;
  quantity: number;
  revenue: number;
  /** NULL where no cost basis exists. Never zero standing in for unknown. */
  directCost: number | null;
  contribution: number | null;
  margin: number | null;
  costConfigured: boolean;
  lines: number;
  invoices: number;
}

export interface ProfitabilityReport {
  from: string;
  to: string;
  clinicId: string | null;
  costBasis: string;
  contributionNote: string;
  rows: ProfitabilityRow[];
  totals: {
    revenue: number;
    costedRevenue: number;
    directCost: number;
    contribution: number;
    margin: number | null;
    rows: number;
    rowsWithoutCost: number;
    revenueWithoutCost: number;
  };
}

// --- Staff benefits ----------------------------------------------------------

export interface StaffBenefitAccountRow {
  id: string;
  staffId: string;
  staffName: string;
  role: string;
  clinicName: string | null;
  benefitYear: number;
  allowance: number;
  used: number;
  remaining: number;
  overdrawn: number;
  notes: string | null;
  members: {
    id: string;
    name: string;
    relationship: string;
    allowanceOverride: number | null;
    linkedPatient: boolean;
  }[];
  usages: {
    id: string;
    usedAt: string;
    amount: number;
    forWhom: string;
    invoiceNumber: string | null;
    recordedBy: string;
    notes: string | null;
  }[];
}

export interface StaffBenefitReport {
  year: number;
  clinicId: string | null;
  note: string;
  accounts: StaffBenefitAccountRow[];
}

// --- EMPLOYEE RECORD --------------------------------------------------------
// One employee, composed from the tables that own each fact. See
// `EmployeeService.record` — there is no second employee record behind this.

export interface EmployeeRecord {
  staffId: string;
  year: number;
  /** EMPLOYEE or CONTRACTOR — what statutory treatment turns on. */
  engagement: 'EMPLOYEE' | 'CONTRACTOR';
  /** NULL for a contractor: they are not on payroll, so it does not apply. */
  payrollReadiness: {
    items: PayrollReadinessItem[];
    done: number;
    total: number;
    blockersOutstanding: number;
    ready: boolean;
  } | null;
  /** Salary as PERIODS, not effective-dated rows. NULL when pay is not visible. */
  salaryPeriods:
    | {
        id: string;
        amount: string;
        basis: string;
        from: string;
        to: string | null;
        current: boolean;
        upcoming: boolean;
        reason: string | null;
      }[]
    | null;
  claims: {
    id: string;
    category: string;
    claimDate: string;
    description: string;
    status: string;
    amountClaimed: string;
    amountApproved: string | null;
    paymentRoute: PaymentRoute | null;
    payoutStatus: PayoutStatus;
    decidedBy: string | null;
  }[];
  identity: {
    fullName: string;
    legalName: string | null;
    accountActive: boolean;
    accountRole: string;
    email: string | null;
    phone: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    nationality: string | null;
    maritalStatus: string | null;
    address: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    emergencyContactRelation: string | null;
  };
  employment: {
    employeeNo: string | null;
    position: string | null;
    department: string | null;
    employmentType: string;
    employmentStatus: string;
    clinicName: string | null;
    /** Who employs them. Not the same fact as which branch they work at. */
    legalEmployerName: string | null;
    manager: string | null;
    startDate: string | null;
    confirmedDate: string | null;
    endDate: string | null;
    endReason: string | null;
    notes: string | null;
  };
  /** False means "you may not read pay", which is not "there is no pay". */
  payVisible: boolean;
  pay: {
    payBasis: 'MONTHLY' | 'HOURLY' | null;
    basicSalary: number | null;
    hourlyRate: number | null;
    bankName: string | null;
    bankAccountOnFile: boolean;
  } | null;
  statutory: {
    epfNumberOnFile: boolean;
    socsoNumberOnFile: boolean;
    taxNumberOnFile: boolean;
    taxCategory: string | null;
    /**
     * WHICH VERSION OF THE STANDING THIS MONTH RESOLVES TO.
     *
     * Everything below it is a fact about a DATE, not a field on a form: the
     * classification in force for the current period. `RESOLVED` means one
     * version covered the whole month; anything else means payroll would
     * refuse, and the values below read as unknown rather than as answers.
     */
    classificationState: 'RESOLVED' | 'NONE_ON_RECORD' | 'CHANGED_MID_PERIOD';
    classificationNote: string;
    classificationEffectiveFrom: string | null;
    epfMembership: string | null;
    lindungParticipation: string | null;
    taxResidence: string | null;
    pcbCategory: string | null;
    qualifyingChildren: number;
    restDayOfWeek: number | null;
    overtimeContractPolicy: string | null;
    epfApplicable: boolean;
    socsoApplicable: boolean;
    eisApplicable: boolean;
    pcbApplicable: boolean;
    note: string;
  };
  leavePolicy: { id: string; name: string } | null;
  attendance: {
    daysRecorded: number;
    daysWorked: number;
    absent: number;
    onLeave: number;
    lateDays: number;
    approvedOvertimeHours: number;
    corrected: number;
    recent: {
      id: string;
      workDate: string;
      status: string;
      clockInAt: string | null;
      clockOutAt: string | null;
      workedMinutes: number | null;
      lateMinutes: number | null;
      overtimeMinutes: number;
      overtimeApproved: boolean;
      corrected: boolean;
    }[];
  };
  payrollHistory: {
    id: string;
    runId: string;
    period: string;
    runStatus: string;
    statutoryStatus: string;
    gross: number | null;
    net: number | null;
    employerCost: number | null;
    epfEmployee: number | null;
    socsoEmployee: number | null;
    eisEmployee: number | null;
    pcb: number | null;
  }[];
  documents: { implemented: boolean; note: string };
}

// --- MARKETING DISPATCH -----------------------------------------------------
// PREPARED, and at most OPENED. There is no SENT and no DELIVERED anywhere in
// this type, because neither is something this system observes.

export interface PreparedMessage {
  dispatchId: string;
  patientId: string;
  name: string;
  phone: string;
  body: string;
  /** A wa.me link a staff member clicks. Clicking is all `markOpened` records. */
  whatsappUrl: string;
}

export interface PreparedDispatchResult {
  templateName: string;
  prepared: number;
  skippedWithoutPhone: number;
  notice: string;
  messages: PreparedMessage[];
}


// ---------------------------------------------------------------------------
// ACCOUNTS PAYABLE — what the clinic owes its suppliers.
// ---------------------------------------------------------------------------

export interface PayableSupplierRow {
  supplierId: string;
  supplierName: string;
  active: boolean;
  paymentTermDays: number | null;
  deliverySlaDays: number | null;
  accountReference: string | null;
  notes: string | null;
  invoices: number;
  billed: number;
  paid: number;
  outstanding: number;
  overdue: number;
  overdueInvoices: number;
  dueThisWeek: number;
  dueThisWeekInvoices: number;
  disputed: number;
  disputedInvoices: number;
  undated: number;
  undatedInvoices: number;
  creditLimit: number | null;
  creditUtilisation: number | null;
  overCreditLimit: boolean;
  creditHeadroom: number | null;
  /** Deliveries measured — an order still in transit is neither on time nor late. */
  deliveries: number;
  averageDeliveryDays: number | null;
  /** NULL when no SLA is configured: not knowing is not the same as meeting it. */
  slaOnTimePercent: number | null;
  slaBreaches: number;
}

export interface PayablesSummary {
  asOf: string;
  totals: {
    suppliers: number;
    invoices: number;
    billed: number;
    paid: number;
    outstanding: number;
    overdue: number;
    overdueInvoices: number;
    dueThisWeek: number;
    dueThisWeekInvoices: number;
    disputed: number;
    undated: number;
    undatedInvoices: number;
  };
  /** Suppliers with money owed and no payment term recorded. */
  suppliersWithoutTerms: string[];
  overLimit: string[];
  bySupplier: PayableSupplierRow[];
}

export interface PayableInvoiceRow {
  id: string;
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  paymentTermDays: number | null;
  total: number;
  tax: number | null;
  paid: number;
  outstanding: number;
  overpaid: number;
  status: 'OPEN' | 'PAID' | 'DISPUTED' | 'CANCELLED';
  disputeReason: string | null;
  settled: boolean;
  overdue: boolean;
  daysUntilDue: number | null;
  ageBucket: 'NOT_DUE' | 'D1_30' | 'D31_60' | 'D61_90' | 'D90_PLUS' | null;
  goodsReceivedNoteId: string | null;
  purchaseOrderId: string | null;
  receivedAt: string | null;
  purchaseOrderOrderedAt: string | null;
  /** What the linked delivery was worth. NULL when it cannot be checked. */
  receivedValue: number | null;
  /** Invoice minus delivery. NULL when unmatched; non-zero is a question. */
  matchVariance: number | null;
  documentUrl: string | null;
  notes: string | null;
  recordedBy: string;
  createdAt: string;
}

export interface SupplierPaymentRow {
  id: string;
  supplierId: string;
  supplierName: string;
  paidAt: string;
  amount: number;
  method: string | null;
  reference: string | null;
  notes: string | null;
  recordedBy: string;
  settled: { supplierInvoiceId: string; invoiceNumber: string; amount: number }[];
}


// ---------------------------------------------------------------------------
// NEW ITEM REQUESTS — asking for something the catalogue does not have yet.
// ---------------------------------------------------------------------------

export interface NewItemRequestRow {
  id: string;
  requestedName: string;
  reason: string;
  comments: string | null;
  clinicName: string | null;
  suggestedSupplier: string | null;
  packSizeNote: string | null;
  indicativeCost: number | null;
  indicativePrice: number | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  /** What the catalogue check found, if anything. A prompt, never an automatic merge. */
  possibleDuplicate: { itemId: string; name: string; code: string | null; active: boolean } | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdItem: {
    itemId: string;
    name: string;
    active: boolean;
    /** TRUE until the first delivery arrives — the item is not usable yet. */
    awaitingFirstReceipt: boolean;
  } | null;
  requestedBy: string;
  createdAt: string;
}

export interface SupplierOption {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// PANEL MONEY, SEEN FROM FINANCE
//
// Three questions the panel work queue structurally cannot answer, because two
// are about something MISSING and one is about money that has already left.
// See apps/api/src/finance/panel-money.ts.
// ---------------------------------------------------------------------------

export type PanelBillingState = 'CLAIMED' | 'UNCLAIMED' | 'UNDER_CLAIMED' | 'OVER_CLAIMED';

export type FeeEvidenceState =
  | 'TAKEN'
  | 'NOT_TAKEN'
  | 'OVERPAID'
  | 'PENDING'
  | 'NOT_PAID'
  | 'INCONCLUSIVE'
  | 'NOT_APPLICABLE';

export const FEE_EVIDENCE_LABELS: Record<FeeEvidenceState, string> = {
  TAKEN: 'Fee taken as configured',
  NOT_TAKEN: 'Fee NOT taken',
  OVERPAID: 'Paid above the claim',
  PENDING: 'Still owed',
  NOT_PAID: 'Closed without payment',
  INCONCLUSIVE: 'Cannot be attributed',
  NOT_APPLICABLE: 'No withheld fee',
};

export interface PanelMoneyUnclaimedRow {
  invoiceId: string;
  invoiceNumber: string;
  visitNumber: string | null;
  clinicName: string | null;
  panelClinicId: string | null;
  panelName: string | null;
  settledAt: string | null;
  billed: number;
  claimed: number;
  unclaimed: number;
  state: PanelBillingState;
  ageDays: number;
}

export interface PanelMoneyExceptionRow {
  panelClinicId: string;
  panelName: string;
  invoiceNumber: string | null;
  state: FeeEvidenceState;
  claimed: number;
  expected: number;
  received: number;
  difference: number;
}

export interface PanelMoneyRemittanceRow {
  remittanceId: string;
  panelClinicId: string;
  panelName: string;
  receivedAt: string;
  reference: string | null;
  claims: number;
  gross: number;
  withheld: number;
  net: number;
  expectedFee: number;
  unexplained: number;
  /** FALSE where the remittance was keyed net and there is nothing to check. */
  withholdingChecked: boolean;
  agrees: boolean;
}

export interface PanelMoneyPanelRow {
  panelClinicId: string | null;
  panelName: string;
  billed: number;
  claimed: number;
  unclaimed: number;
  unclaimedInvoices: number;
  banked: number;
  withheld: number;
  feeBorne: number;
  feeExpected: number;
}

export interface PanelMoneyPosition {
  period: { from: string | null; to: string | null; asOf: string };
  billing: {
    invoices: number;
    billed: number;
    claimed: number;
    unclaimed: number;
    unclaimedInvoices: number;
    overClaimed: number;
    overClaimedInvoices: number;
    claimedRate: number | null;
    /** Claims imported from the previous system: in neither `billed` nor `claimed`. */
    importedClaims: number;
    aging: { current: number; d31_60: number; d61_90: number; d90_plus: number };
  };
  feeCost: {
    borne: number;
    expected: number;
    unresolvedClaims: number;
    unresolvedFee: number;
  };
  banked: {
    remittances: number;
    gross: number;
    withheld: number;
    net: number;
    unexplained: number;
    remittancesThatDisagree: number;
  };
  feeEvidence: {
    taken: number;
    notTaken: number;
    notTakenAmount: number;
    overpaid: number;
    overpaidAmount: number;
    pending: number;
    notPaid: number;
    inconclusive: number;
  };
  byPanel: PanelMoneyPanelRow[];
  unclaimedInvoiceRows: PanelMoneyUnclaimedRow[];
  exceptionRows: PanelMoneyExceptionRow[];
  remittanceRows: PanelMoneyRemittanceRow[];
}

// ---------------------------------------------------------------------------
// HISTORICAL CLAIM IMPORT (G-12)
//
// Kuwick cannot start empty on the day the clinic switches over. See
// apps/api/src/panel/claim-import.service.ts for the six safety rules.
// ---------------------------------------------------------------------------

export interface ImportRowProblem {
  /** The line number IN THE SPREADSHEET, header counted. */
  line: number;
  column: string;
  message: string;
}

export interface ClaimImportResult {
  /** TRUE when nothing was written — a dry run, or a file with problems. */
  dryRun: boolean;
  panelClinicId: string;
  panelName: string;
  feeTreatment: PanelFeeTreatment;
  rowCount: number;
  importable: number;
  alreadyPresent: number;
  problems: ImportRowProblem[];
  totals: {
    claimed: number;
    fee: number;
    expectedReceivable: number;
    approved: number;
    rejected: number;
    received: number;
    outstanding: number;
  };
  importBatchId?: string;
}

export interface ClaimImportBatchRow {
  id: string;
  panelClinicId: string;
  panelName: string;
  /** NULL where the person importing did not say which branch the file covers. */
  clinicId: string | null;
  clinicName: string | null;
  fileName: string | null;
  rowCount: number;
  importedCount: number;
  skippedCount: number;
  claimedTotal: number;
  expectedTotal: number;
  receivedTotal: number;
  outstandingTotal: number;
  note: string | null;
  importedBy: string;
  importedAt: string;
}

// ===========================================================================
// MALAYSIA PAYROLL — STAGE 1 + STAGE 2
// ===========================================================================

export interface LegalEmployerRow {
  id: string;
  name: string;
  registrationNo: string | null;
  epfEmployerNo: string | null;
  socsoEmployerNo: string | null;
  lhdnEmployerNo: string | null;
  hrdRegistrationNo: string | null;
  /** Superseded by the dated class below; kept for reconciliation only. */
  legacyHrdCategory: string | null;
  legacyHrdLevyRate: number | null;
  /** The HRD Corp class in force today, and the Act's rate for it. */
  hrdRegistration: 'MANDATORY_SECTION_14' | 'OPTIONAL_SECTION_15' | 'NOT_REGISTERED' | null;
  hrdLevyRatePercent: number | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  bankName: string | null;
  /**
   * PRESENCE AND THE LAST FOUR, never the number. The full account is
   * write-only through the form; only the audited bank-listing export
   * carries it.
   */
  bankAccountOnFile: boolean;
  bankAccountLastFour: string | null;
  bankAccountName: string | null;
  active: boolean;
  employeeCount: number;
  payrollRunCount: number;
  statutoryReadiness: { complete: boolean; missing: string[]; note: string };
}

export interface SalaryHistoryRow {
  id: string;
  basis: 'MONTHLY' | 'DAILY' | 'HOURLY';
  amount: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  note: string | null;
  recordedBy: string;
  recordedAt: string;
  current: boolean;
}

export interface PayComponentRow {
  id: string;
  code: string;
  name: string;
  type: 'ADDITION' | 'DEDUCTION' | 'OVERTIME';
  category: string;
  includeIn: string;
  pcbLiable: boolean;
  epfLiable: boolean;
  socsoLiable: boolean;
  eisLiable: boolean;
  hrdLiable: boolean;
  includeInOrpBase: boolean;
  includeInUnpaidLeaveBase: boolean;
  additionalRemuneration: boolean;
  pcbExemptionLimitCents: number | null;
  eaField: string | null;
  prorated: boolean;
  employerSide: boolean;
  systemControlled: boolean;
  active: boolean;
  verificationStatus: string;
  version: number;
  effectiveFrom: string;
}

export interface PayComponentList {
  components: PayComponentRow[];
  verificationNotice: { anyVerified: boolean; statement: string };
}

export interface PayrollInputRow {
  id: string;
  staffId: string;
  staffName: string;
  componentCode: string;
  label: string | null;
  amount: string;
  kind: 'RECURRING' | 'ADDITIONAL';
  source: string;
  sourceRecordId: string | null;
  earnedPeriod: string | null;
  reason: string | null;
  note: string | null;
  enteredBy: string;
  enteredAt: string;
  editable: boolean;
}

export interface PayrollExceptionRow {
  id: string;
  severity: 'BLOCKING' | 'WARNING' | 'INFO';
  code: string;
  staffId: string | null;
  staffName: string | null;
  cause: string;
  consequence: string;
  remediation: string;
  deepLink: string | null;
  overridable: boolean;
  overriddenBy: string | null;
  overrideReason: string | null;
  overriddenAt: string | null;
}

/**
 * THE CANONICAL EXCEPTION SUMMARY, computed by the API from the
 * `payroll_exceptions` rows and by nothing else. Every surface that states a
 * number about a run's exceptions renders one of these fields.
 */
export interface PayrollExceptionGate {
  canApprove: boolean;
  total: number;
  blocking: number;
  warnings: number;
  info: number;
  overridden: number;
  reason: string;
}

export interface PayrollExceptionList {
  exceptions: PayrollExceptionRow[];
  gate: PayrollExceptionGate;
}

export interface PayrollVarianceRow {
  staffId: string;
  name: string;
  previousNetCents: number | null;
  currentNetCents: number | null;
  deltaCents: number | null;
  percent: number | null;
  status: 'NEW' | 'LEFT' | 'UNCHANGED' | 'MOVED' | 'MATERIAL';
}

export interface PayrollVarianceReport {
  hasPrevious: boolean;
  previousPeriod: string;
  rows: PayrollVarianceRow[];
  totals: { field: string; previous: number; current: number; deltaCents: number; percent: number | null }[];
  headcountPrevious: number;
  headcountCurrent: number;
  joiners: number;
  leavers: number;
  material: PayrollVarianceRow[];
  thresholdPercent: number;
  note: string;
}

/**
 * WHAT A RECALCULATION WOULD CHANGE against the snapshot that was approved.
 * `hasSnapshot: false` is the ordinary case for a run nobody has approved yet.
 */
export interface PayrollCandidateDiff {
  hasSnapshot: boolean;
  note: string;
  snapshotVersion?: number;
  snapshotHash?: string;
  candidateHash?: string;
  diff?: {
    changed: { staffId: string; name: string; field: string; before: number | null; after: number | null; deltaCents: number | null }[];
    added: { staffId: string; name: string }[];
    removed: { staffId: string; name: string }[];
    totals: { field: string; before: number; after: number; deltaCents: number }[];
    identical: boolean;
  };
}

export interface PayrollSnapshotRow {
  id: string;
  version: number;
  hash: string;
  reason: string | null;
  createdBy: string;
  createdAt: string;
  /**
   * CHECKED ON EVERY READ, never stored. `VERIFIED` means the payload still
   * hashes to the hash recorded with it AND its totals follow from its own
   * employee rows; `TAMPERED` means it does not hash; `INCONSISTENT` means it
   * is intact but does not add up; `UNVERIFIABLE_SCHEMA` means it was written
   * before the payload carried enough to re-check the arithmetic.
   */
  verdict: 'VERIFIED' | 'TAMPERED' | 'INCONSISTENT' | 'UNVERIFIABLE_SCHEMA';
  verificationNote: string;
  schemaVersion: number;
  totals: {
    grossCents: number;
    deductionCents: number;
    netCents: number;
    employerCostCents: number;
    employeeCount: number;
  };
}

// ===========================================================================
// STAGE 2.5 — CROSS-MODULE PAYROLL INTEGRATION
// ===========================================================================

export type PaymentRoute = 'PAYROLL' | 'FINANCE';
export type PayoutStatus = 'PENDING' | 'IN_PAYROLL' | 'PAID' | 'VOID';
export type StaffClaimStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface StaffClaimRow {
  id: string;
  staffId: string;
  staffName: string;
  category: string;
  amountClaimed: string;
  amountApproved: string | null;
  claimDate: string;
  description: string;
  status: StaffClaimStatus;
  submittedBy: string;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  paymentRoute: PaymentRoute | null;
  payoutStatus: PayoutStatus;
  payrollPeriod: string | null;
  financeReference: string | null;
  paidAt: string | null;
  attachments: { id: string; fileName: string; mimeType: string; fileSize: number }[];
  /** Where this claim is being paid from, said in words. */
  routeExplanation: string;
}

export interface StaffClaimEventRow {
  id: string;
  event: string;
  detail: string | null;
  fromStatus: StaffClaimStatus | null;
  toStatus: StaffClaimStatus | null;
  actor: string;
  at: string;
}

export interface LocumSessionRow {
  id: string;
  staffId: string;
  staffName: string;
  clinicId: string;
  clinicName: string;
  sessionDate: string;
  label: string | null;
  hours: number | null;
  hourlyRate: string | null;
  sessionFee: string | null;
  computedFee: string | null;
  status: 'PLANNED' | 'COMPLETED' | 'APPROVED' | 'CANCELLED';
  approvedAmount: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  paymentRoute: PaymentRoute;
  payoutStatus: PayoutStatus;
  invoiceReference: string | null;
  paidAt: string | null;
  note: string | null;
}

export interface LocumPayableSummary {
  from: string;
  to: string;
  route: 'FINANCE';
  people: {
    staffId: string;
    name: string;
    sessions: number;
    awaitingApproval: number;
    approved: string;
    outstanding: string;
  }[];
  totalApproved: string;
  totalOutstanding: string;
  sessionsAwaitingApproval: number;
}

export type ParityVerdict =
  | 'MATCH' | 'LEGACY_ONLY' | 'CANONICAL_ONLY' | 'AMOUNT_DIFFERS'
  | 'CHANGED_MID_PERIOD' | 'BASIS_UNSUPPORTED' | 'NEITHER';

export interface SalaryParityReport {
  period: string;
  total: number;
  matched: number;
  mismatched: number;
  byVerdict: Record<ParityVerdict, number>;
  lines: {
    staffId: string;
    name: string;
    verdict: ParityVerdict;
    legacyCents: number | null;
    canonicalCents: number | null;
    differenceCents: number | null;
    explanation: string;
  }[];
  clean: boolean;
  summary: string;
}

export type PayrollHomeState = 'NOT_STARTED' | 'STARTED' | 'READY_TO_REVIEW' | 'APPROVED' | 'PAID';

// ---------------------------------------------------------------------------
// PAYROLL READINESS — who can be paid, before a run exists. Built by the same
// server code as the employee record's checklist, from the same facts the
// calculation blocks on.
// ---------------------------------------------------------------------------

export interface PayrollReadinessItem {
  key: string;
  label: string;
  /** BLOCKING mirrors the run's own exceptions; ADVISORY is real but non-gating. */
  severity: 'BLOCKING' | 'ADVISORY';
  done: boolean;
  detail: string;
}

export interface PayrollReadiness {
  period: string;
  periodLabel: string;
  summary: {
    total: number;
    ready: number;
    withBlockers: number;
    withAdvisories: number;
    withoutEmployer: number;
  };
  employers: {
    id: string;
    name: string;
    registrationNo: string | null;
    employees: number;
    epfEmployerNoOnFile: boolean;
    socsoEmployerNoOnFile: boolean;
    lhdnEmployerNoOnFile: boolean;
    bankAccountOnFile: boolean;
    missing: string[];
    ready: boolean;
  }[];
  employees: {
    staffId: string;
    name: string;
    position: string | null;
    legalEmployerId: string | null;
    employerName: string | null;
    startDate: string | null;
    readiness: {
      items: PayrollReadinessItem[];
      done: number;
      total: number;
      blockersOutstanding: number;
      ready: boolean;
    };
  }[];
}

export interface PayrollHome {
  period: string;
  periodLabel: string;
  /**
   * The registry's own answer for this period, run or no run — what the
   * safety banner reads when nothing has been started, so a fully covered
   * month is not painted "not production-ready" for being unopened.
   */
  periodStatutoryStatus: 'CONFIGURED' | 'PROVISIONAL' | 'NOT_CONFIGURED';
  run: {
    id: string;
    status: string;
    statutoryStatus: string;
    netTotal: string;
    employerCostTotal: string;
    employeeCount: number;
    calculatedAt: string | null;
    approvedAt: string | null;
    paymentDate: string | null;
  } | null;
  state: PayrollHomeState;
  gate: PayrollExceptionGate | null;
  employeesExpected: number;
  setup: {
    total: number;
    ready: number;
    salaryOnRecord: number;
    bankAccount: number;
    dateOfBirth: number;
    /**
     * Who still needs monthly tax ANSWERED for this month: no tax profile on
     * their standing (Kuwick would calculate it from one) and no hand-keyed
     * figure either. Kept out of `ready` because it is this month's work,
     * not a gap in the employee record; see payroll-journey.service.ts.
     */
    pcbMissing: number;
  };
  feeding: {
    attendanceDays: number;
    overtimeHours: number;
    unapprovedOvertimeHours: number;
    unpaidLeaveRequests: number;
    claims: number;
    claimTotal: string;
    incentives: number;
    incentiveTotal: string;
  };
  contractorsExcluded: number;
  recent: {
    id: string;
    period: string;
    status: string;
    statutoryStatus: string;
    employeeCount: number;
    netTotal: string;
    employerCostTotal: string;
  }[];
}

export interface PayrollJourneyPayItem {
  id: string;
  componentCode: string;
  label: string;
  amount: string;
  source: string;
  sourceRecordId: string | null;
  provenance: string | null;
  earnedPeriod: string | null;
  editable: boolean;
}

export interface PayrollJourney {
  run: {
    id: string;
    period: string;
    periodLabel: string;
    clinicName: string;
    status: string;
    statutoryStatus: string;
    paymentDate: string | null;
    netTotal: string;
    grossTotal: string;
    deductionTotal: string;
    employerCostTotal: string;
    employeeCount: number;
  };
  employees: {
    included: number;
    newJoiners: number;
    leavers: number;
    needsSetup: number;
    rows: {
      staffId: string;
      name: string;
      position: string | null;
      employerName: string | null;
      startDate: string | null;
      state: 'READY' | 'NEEDS_ATTENTION' | 'NEEDS_SETUP';
      reason: string | null;
      includedInRun: boolean;
    }[];
    contractors: { staffId: string; name: string }[];
  };
  attendance: {
    rows: {
      staffId: string;
      name: string;
      daysWorked: number;
      approvedOvertimeHours: number;
      unapprovedOvertimeHours: number;
      missingPunchDays: number;
      unpaidLeaveDays: number;
      unpaidLeaveRequests: { id: string; from: string; to: string; approvedBy: string | null }[];
      paidLeaveDays: number;
    }[];
    totalDaysWorked: number;
    totalApprovedOvertimeHours: number;
    totalUnapprovedOvertimeHours: number;
    totalUnpaidLeaveDays: number;
    totalMissingPunchDays: number;
  };
  pay: {
    rows: {
      staffId: string;
      name: string;
      /** The same position the directory shows, for the register's person cell. */
      position: string | null;
      /**
       * WHETHER THIS PERSON IS READY, joined server-side from the employee
       * record and the exception rows. The register renders a green / amber /
       * red status beside every name from these; `fixLink` opens the remedy
       * for the most serious thing wrong, not the first one found.
       */
      state: 'READY' | 'NEEDS_ATTENTION' | 'NEEDS_SETUP';
      reason: string | null;
      blockers: number;
      warnings: number;
      fixLink: string | null;
      basicSalary: string;
      allowances: string;
      overtimePay: string;
      incentives: string;
      bonus: string;
      grossPay: string;
      unpaidLeaveDeduction: string;
      otherDeductions: string;
      netPay: string;
      employerCost: string;
      statutoryEmployee: string | null;
      pcb: string | null;
      /** SKBBK. Employee-borne, employer-remitted; null = participation unrecorded. */
      lindungEmployee: string | null;
      /**
       * The schemes unsummed, so the register can carry EPF and SOCSO/EIS as
       * their own columns. Null stays null all the way to the cell: a scheme
       * that could not be worked out renders "—", never 0.00.
       */
      epfEmployee: string | null;
      epfEmployer: string | null;
      socsoEmployee: string | null;
      socsoEmployer: string | null;
      eisEmployee: string | null;
      eisEmployer: string | null;
      /** HRD Corp levy — an employer cost, never a deduction. */
      hrdLevy: string | null;
      /** What the employer pays on top of this person's wage. */
      employerContributions: string;
      /**
       * THE TWO GROUPED COLUMNS THE REGISTER OPENS WITH — summed by the
       * server. "Additional" is allowances plus whatever else reached gross (a
       * reimbursed claim, mileage); "SOCSO/EIS" is the pair that always moves
       * together, null if EITHER scheme is unknown. The drawer shows the
       * components individually.
       */
      additionalEarnings: string;
      socsoEis: string | null;
      /**
       * The employer-selected EPF basis as APPLIED — null when no selection
       * is recorded and the statutory assessment governs alone. A non-empty
       * `excluded` means the month carries a blocking statutory discrepancy.
       */
      epfBasis: {
        mode: string;
        applied: string;
        assessed: string;
        excluded: { label: string; amount: string }[];
        ineffective: { label: string; amount: string }[];
      } | null;
      /** Basic less unpaid leave — the engine's grouping, not the screen's. */
      salaryEarned: string;
      /** Incentives plus bonus, grouped the way the earnings step shows them. */
      incentive: string;
      /** Residual of the line's own gross, so the row cannot fail to add up. */
      otherEarnings: string;
      /** The line's own gross minus its own net. */
      deductionTotal: string;
      items: PayrollJourneyPayItem[];
    }[];
    /**
     * THE FIGURES THE MONEY STEPS RENDER. Worked out by the server from the
     * payslip lines; the screens display them and compute nothing. A scheme
     * that was not calculated is a COUNT here, never a zero in a total.
     */
    totals: {
      basic: string;
      unpaidLeave: string;
      salaryEarned: string;
      allowances: string;
      overtime: string;
      incentive: string;
      otherEarnings: string;
      additions: string;
      gross: string;
      statutoryEmployee: string;
      statutoryNotCalculated: number;
      pcb: string;
      pcbMissing: number;
      lindung: string;
      lindungNotDetermined: number;
      otherDeductions: string;
      deductions: string;
      net: string;
      /**
       * What the employer pays ON TOP of wages — the employer's statutory
       * share plus any levy — and gross plus that. Both summed by the server
       * from the lines, because `employerCost - gross` performed in a browser
       * is a payroll subtraction done by a screen.
       */
      employerContributions: string;
      employerCost: string;
      /** What the register's two grouped columns foot on. */
      additionalEarnings: string;
      socsoEis: string;
      socsoEisNotCalculated: number;
      /**
       * PER SCHEME, so a column headed EPF foots on EPF. `statutoryEmployee`
       * is the three added together and is what the month header reads.
       */
      epfEmployee: string;
      socsoEmployee: string;
      eisEmployee: string;
      addsUp: boolean;
      discrepancy: string | null;
    };
  };
  review: {
    gate: PayrollExceptionGate;
    attention: {
      id: string;
      code: string;
      severity: 'BLOCKING' | 'WARNING' | 'INFO';
      staffId: string | null;
      name: string | null;
      what: string;
      why: string;
      whatToDo: string;
      link: string | null;
      overridable: boolean;
      overridden: boolean;
      blocksApproval: boolean;
    }[];
    mustFix: number;
    worthALook: number;
  };
  /**
   * STEP 6 — who is allowed to approve, and whether this reader is one of them.
   * Answered by the same rule the server enforces with, so the screen never
   * offers a button the server is going to refuse.
   */
  approval: PayrollApprovalState;
}

export interface PayrollApprovalState {
  /** The rule in one sentence, in the owner's words. */
  rule: string;
  required: number;
  given: { name: string; at: string; sequence: number; wasOwnSelfApproval: boolean }[];
  youMayApprove: boolean;
  /** Why not — a different sentence from "this run has problems". */
  whyNot: string | null;
  /** Whether pressing Approve finishes the run or records one of two. */
  completesTheRun: boolean;
}

// ---------------------------------------------------------------------------
// PAYROLL REPORTS.
//
// Thirteen reports over the SAME rows the run wrote. Nothing recomputes a
// figure, and every row carries `drill` — the canonical record behind it —
// because a total nobody can open is a number you have to trust.
// ---------------------------------------------------------------------------

export interface PayrollReportHeader {
  runId: string;
  period: string;
  periodLabel: string;
  clinicName: string;
  status: string;
  provisional: boolean;
  provisionalNote: string | null;
}

export interface PayrollReportCatalogue {
  available: { key: string; title: string; description: string; scope: 'RUN' | 'DATE_RANGE' | 'EMPLOYEE' | 'YEAR' }[];
  /** Named absences carrying a reason, not a "coming soon". */
  notAvailableYet: { key: string; title: string; why: string }[];
}

export interface PayrollRegisterReport extends PayrollReportHeader {
  report: 'PAYROLL_REGISTER';
  rows: {
    staffId: string;
    name: string;
    basicSalary: string;
    allowances: string;
    overtimePay: string;
    incentives: string;
    bonus: string;
    grossPay: string;
    unpaidLeaveDeduction: string;
    otherDeductions: string;
    /** Null, never 0, when a statutory figure could not be worked out. */
    statutoryEmployee: string | null;
    netPay: string;
    employerCost: string;
    drill: string;
    components: {
      code: string;
      label: string;
      amount: string;
      source: string;
      sourceRecordId: string | null;
      reason: string | null;
    }[];
  }[];
  /** Every column the report emits foots, computed by the API, never here. */
  totals: {
    basicSalary: string;
    allowances: string;
    overtimePay: string;
    incentives: string;
    bonus: string;
    unpaidLeaveDeduction: string;
    otherDeductions: string;
    grossPay: string;
    deductions: string;
    netPay: string;
    employerCost: string;
    employees: number;
  };
}

export interface PayrollCostBucket {
  key: string;
  label: string;
  employees: number;
  gross: string;
  employerContributions: string | null;
  employerCost: string;
  notComputed: number;
  note: string | null;
}

export interface PayrollEmployerCostReport extends PayrollReportHeader {
  report: 'EMPLOYER_COST';
  byBranch: PayrollCostBucket[];
  byLegalEmployer: PayrollCostBucket[];
  total: { gross: string; employerCost: string; employees: number };
}

export interface PayrollStatutoryReport extends PayrollReportHeader {
  report: 'STATUTORY_TOTALS';
  notASubmission: string;
  byEmployer: {
    employerId: string;
    employerName: string;
    employees: number;
    canFile: { epf: boolean; socso: boolean; lhdn: boolean };
    schemes: {
      scheme: string;
      employee: string | null;
      employer: string | null;
      total: string | null;
      notComputed: number;
      note: string | null;
    }[];
  }[];
}

export interface PayrollMonthComparisonReport extends PayrollReportHeader {
  report: 'VARIANCE';
  comparedWith: { runId: string; period: string; periodLabel: string } | null;
  note: string | null;
  rows: {
    staffId: string;
    name: string;
    state: 'BOTH' | 'JOINED' | 'LEFT';
    current: string | null;
    previous: string | null;
    movement: string;
    drill: string;
  }[];
  totals: {
    current: string;
    previous: string;
    movement: string;
    joined: number;
    left: number;
  } | null;
}

export interface PayrollClaimsReport {
  report: 'CLAIMS';
  period: { from: string; to: string };
  periodMeans: string;
  rows: {
    id: string;
    staffId: string;
    name: string;
    category: string;
    description: string;
    claimDate: string;
    claimed: string;
    approved: string | null;
    status: string;
    route: string | null;
    settled: boolean;
    decidedBy: string | null;
    decidedAt: string | null;
    drill: string;
  }[];
  totals: {
    claims: number;
    approved: number;
    rejected: number;
    throughPayroll: string;
    throughFinance: string;
    awaitingPayment: number;
  };
  doublePaymentCheck: string;
}

export interface PayrollHistoryReport {
  report: 'PAYROLL_HISTORY';
  staffId: string;
  name: string;
  year: number | null;
  rows: {
    runId: string;
    period: string;
    periodLabel: string;
    clinicName: string;
    runType: string;
    sequence: number;
    status: string;
    gross: string;
    statutoryEmployee: string | null;
    otherDeductions: string;
    net: string;
    employerCost: string;
    approvedAt: string | null;
    paidAt: string | null;
    approvedVersions: number;
    /** Candidate-figures / corrected-run annotation, from the API. */
    note: string | null;
    drill: string;
  }[];
  totals: {
    runs: number;
    approvedRuns: number;
    approvedGross: string;
    approvedNet: string;
    totalsMean: string;
  };
}

export interface PayrollPcbSummaryReport extends PayrollReportHeader {
  report: 'PCB_SUMMARY';
  rows: {
    staffId: string;
    name: string;
    identifier: string | null;
    taxNumber: string | null;
    pcb: string | null;
    /** From the calculation's own marker — never inferred from the prose. */
    source: 'CALCULATED' | 'ENTERED' | null;
    note: string | null;
    zakatViaPayroll: string;
    tp1: { deductions: string; zakatSelfPaid: string; receivedDate: string | null } | null;
    drill: string;
  }[];
  totals: {
    employees: number;
    pcb: string | null;
    zakatViaPayroll: string;
    calculated: number;
    entered: number;
    missing: number;
    tp1Applied: number;
  };
  note: string;
}

export interface PayrollYtdReport {
  report: 'YTD';
  taxYear: number;
  legalEmployerId: string | null;
  rows: {
    staffId: string;
    name: string;
    legalEmployerId: string;
    employerName: string;
    monthsRecorded: number;
    months: { month: number; source: string }[];
    gross: string;
    additionalRemuneration: string;
    pcb: string;
    cp38: string;
    zakat: string;
    epfEmployee: string;
    epfEmployer: string;
    socsoEmployee: string;
    socsoEmployer: string;
    eisEmployee: string;
    eisEmployer: string;
    lindungEmployee: string;
    deductionsApplied: string;
    note: string | null;
    drill: string;
  }[];
  previousEmployment: {
    staffId: string;
    name: string;
    previousEmployerName: string;
    gross: string;
    epf: string;
    mtdPaid: string;
    zakat: string;
    source: string;
  }[];
  totals: {
    employees: number;
    gross: string;
    pcb: string;
    zakat: string;
    epfEmployee: string;
    epfEmployer: string;
    socsoEmployee: string;
    socsoEmployer: string;
    eisEmployee: string;
    eisEmployer: string;
    lindungEmployee: string;
  };
  note: string;
}

export interface PayrollOvertimeReport extends PayrollReportHeader {
  report: 'OVERTIME';
  orp: { overtimeDays: number; hoursPerDay: number; meaning: string };
  rows: {
    staffId: string;
    name: string;
    hours: number;
    pay: string;
    hourlyRateUsed: number | null;
    tiers: {
      label: string;
      hours: number;
      ordinaryRateDays: number;
      hourlyRate: number;
      total: number;
      provision: string;
    }[];
    drill: string;
  }[];
  totals: { employees: number; hours: number; pay: string };
  note: string;
}

export interface PayrollUnpaidLeaveReport extends PayrollReportHeader {
  report: 'UNPAID_LEAVE';
  divisor: { unpaidLeaveDays: number; meaning: string };
  rows: {
    staffId: string;
    name: string;
    days: number;
    dailyRate: number | null;
    reduction: string;
    grossAfter: string;
    drill: string;
  }[];
  totals: { employees: number; days: number; reduction: string };
  note: string;
}

export interface PayrollIncentivesReport extends PayrollReportHeader {
  report: 'INCENTIVES';
  rows: {
    staffId: string;
    name: string;
    component: string;
    label: string;
    amount: string;
    source: string;
    sourceRecordId: string | null;
    reason: string | null;
    earnedPeriod: string | null;
    drill: string;
  }[];
  totals: { entries: number; employees: number; incentives: string; bonus: string };
  note: string;
}

export interface PayrollExceptionsReport extends PayrollReportHeader {
  report: 'EXCEPTIONS';
  rows: {
    id: string;
    severity: string;
    code: string;
    staffId: string | null;
    name: string | null;
    cause: string;
    consequence: string;
    remediation: string;
    overridable: boolean;
    overridden: boolean;
    overriddenBy: string | null;
    overrideReason: string | null;
    overriddenAt: string | null;
    deepLink: string | null;
  }[];
  totals: {
    exceptions: number;
    blocking: number;
    blockingOpen: number;
    warnings: number;
    overridden: number;
  };
  note: string;
}

export interface PayrollPaymentStatusReport extends PayrollReportHeader {
  report: 'PAYMENT_STATUS';
  runPaidAt: string | null;
  current: {
    batchId: string;
    version: number;
    status: string;
    statusMeans: string;
    total: string;
    includedCount: number;
    excludedCount: number;
    snapshotVersion: number;
    preparedBy: string | null;
    preparedAt: string;
    downloadedBy: string | null;
    downloadedAt: string | null;
    paidRecordedBy: string | null;
    paidRecordedAt: string | null;
    paymentDate: string | null;
    paymentReference: string | null;
    lines: {
      staffId: string;
      name: string;
      bankName: string | null;
      accountEnding: string | null;
      amount: string;
      included: boolean;
      exclusionReason: string | null;
    }[];
  } | null;
  supersededBatches: { batchId: string; version: number; status: string; total: string; preparedAt: string }[];
  note: string | null;
}

/**
 * One dated version of an employee's statutory standing, with what it changed
 * against the version before it — the record the classification editor shows.
 */
export interface StatutoryClassificationVersion {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  current: boolean;
  epfApplicable: boolean;
  epfMembership: string | null;
  epfEmployeeRate: number | null;
  socsoApplicable: boolean;
  eisApplicable: boolean;
  lindungParticipation: string | null;
  pcbApplicable: boolean;
  taxResidence: string | null;
  pcbCategory: string | null;
  qualifyingChildren: number;
  disabledSelf: boolean;
  disabledSpouse: boolean;
  restDayOfWeek: number | null;
  overtimeContractPolicy: string | null;
  reason: string | null;
  note: string | null;
  recordedBy: string | null;
  recordedAt: string;
  /** What this version changed, in words, from the API's own diff. */
  changed: string[];
}

/** The body POST /statutory-classification accepts — a statement from a date. */
export interface RecordStatutoryClassificationBody {
  effectiveFrom: string;
  epfApplicable?: boolean;
  epfMembership?: string | null;
  socsoApplicable?: boolean;
  eisApplicable?: boolean;
  lindungParticipation?: string | null;
  pcbApplicable?: boolean;
  taxResidence?: string | null;
  pcbCategory?: string | null;
  qualifyingChildren?: number;
  disabledSelf?: boolean;
  disabledSpouse?: boolean;
  restDayOfWeek?: number | null;
  overtimeContractPolicy?: string | null;
  reason?: string;
}

/** One month of opening year-to-date, in cents, as the import endpoint takes it. */
export interface YtdOpeningMonthBody {
  staffId: string;
  taxYear: number;
  month: number;
  grossCents: number;
  additionalRemunerationCents?: number;
  pcbCents?: number;
  cp38Cents?: number;
  zakatCents?: number;
  epfEmployeeCents?: number;
  epfEmployerCents?: number;
  socsoEmployeeCents?: number;
  socsoEmployerCents?: number;
  eisEmployeeCents?: number;
  eisEmployerCents?: number;
  lindungEmployeeCents?: number;
  deductionsCents?: number;
}

/** Who is allowed to approve payroll in this clinic. Payroll settings. */
export interface PayrollApprovalPolicy {
  mode: 'STANDARD' | 'MAKER_CHECKER' | 'DUAL_APPROVAL';
  allowOwnerSelfApproval: boolean;
  approvalsRequired: number;
  description: string;
  approvers: { total: number; owners: number; names: string[] };
  /** Empty when the chosen rule can actually take effect. */
  inert: string[];
  limits: string[];
}

/**
 * HOW THIS CLINIC MEASURES ATTENDANCE.
 *
 * `source` is on the response because "why is 09:06 late here and not at the
 * other branch" is the first question anybody asks, and the honest answer is
 * one of three: this clinic's own row, the group's default, or Kuwick's.
 */
export interface AttendancePolicy {
  lateGraceMinutes: number;
  earlyOutGraceMinutes: number;
  overtimeMinimumMinutes: number;
  overtimeRoundingMinutes: number;
  overtimeRequiresApproval: boolean;
  countEarlyClockIn: boolean;
  unpaidBreakMinutes: number;
  breakAfterMinutes: number;
  maximumShiftHours: number;
}

export interface EffectiveAttendancePolicy {
  clinicId: string | null;
  policy: AttendancePolicy;
  source: 'CLINIC' | 'GROUP_DEFAULT' | 'KUWICK_DEFAULT';
  defaults: AttendancePolicy;
  hasOwnPolicy: boolean;
  hasGroupDefault: boolean;
}
