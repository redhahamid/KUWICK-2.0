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
    /** Claims whose fee direction is unset — their fee is NOT in the figures above. */
    unresolvedFeeDirection: number;
  };
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
  feeDirection: 'ADDED' | 'WITHHELD' | null;
  /** This panel charges a fee and nobody has said which way it moves. */
  feeDirectionUnresolved: boolean;
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
  pendingLeaveApprovals: number;
  unapprovedOvertimeClaims: number;
  missingPunches: number;
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
  exceptions: number;
  lines: number;
  adjustments: number;
  calculatedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  createdBy: string;
  paidAt: string | null;
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
  exceptions: { staffId: string; name: string; issue: string }[];
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
    epfEmployee: number | null;
    epfEmployer: number | null;
    socsoEmployee: number | null;
    socsoEmployer: number | null;
    eisEmployee: number | null;
    eisEmployer: number | null;
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
