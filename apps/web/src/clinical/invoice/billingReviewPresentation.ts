import {
  BillingWorklistItem,
  BillingWorklistState,
  PanelCopaymentType,
  PanelCoverageType,
  PanelVerificationStatus,
  PrescriptionSupplyMode,
  VisitClassification,
} from '../types';

/**
 * G4.5d3c-3b2 (D-094) — the words the counter reads.
 *
 * Presentation only. Every STATE here was decided by the server; this file
 * turns it into a sentence and a colour and does not re-derive chargeability,
 * price or quantity. Raw enums are never rendered.
 */

export interface WorklistStatePresentation {
  label: string;
  color: string;
  /** True when the item is a final charge the counter may add right now. */
  actionable: boolean;
}

const STATE: Record<BillingWorklistState, WorklistStatePresentation> = {
  READY: { label: 'Ready to add', color: 'blue', actionable: true },
  AWAITING_DISPENSE: { label: 'Awaiting dispensing', color: 'gold', actionable: false },
  UNRESOLVED_SUPPLY: { label: 'Supply mode not confirmed', color: 'orange', actionable: false },
  NOT_READY: { label: 'Not ready', color: 'orange', actionable: false },
  NOT_CHARGEABLE: { label: 'Not chargeable', color: 'default', actionable: false },
  TARIFF_REVIEW: { label: 'Tariff requires review', color: 'red', actionable: false },
  // b4 PIECE C (2a) — the branch has no consultation tariff at all, so there
  // is nothing to add and nothing to review a rule against. Amber rather than
  // red: it is a settings gap, not a broken rule, and it does not block the
  // counter from finishing the bill.
  NOT_CONFIGURED: { label: 'No consultation tariff configured', color: 'orange', actionable: false },
  WAIVED: { label: 'Waived', color: 'default', actionable: false },
};

export function worklistState(item: BillingWorklistItem): WorklistStatePresentation {
  if (item.billed) {
    return { label: 'Already invoiced', color: 'green', actionable: false };
  }
  if (item.sourceType === 'CONSULTATION' && item.state === 'READY') {
    return { label: 'Consultation — ready to add', color: 'blue', actionable: true };
  }
  return STATE[item.state] ?? { label: 'Unknown', color: 'default', actionable: false };
}

/** DEFERRED reads differently from an unset mode, so it gets its own words. */
export function worklistDetail(item: BillingWorklistItem): string | null {
  if (item.billed && item.sourceType === 'CONSULTATION') {
    return 'Consultation auto-added from the clinic tariff.';
  }
  if (item.state === 'UNRESOLVED_SUPPLY' && item.supplyMode === 'DEFERRED') {
    return 'Deferred supply must be resolved by the prescriber.';
  }
  return item.stateReason;
}

export const SOURCE_TYPE_LABEL: Record<BillingWorklistItem['sourceType'], string> = {
  PRESCRIPTION: 'Medication',
  ORDER_SERVICE: 'Procedure / Service',
  CONSULTATION: 'Consultation',
};

export const SUPPLY_MODE_LABEL: Record<PrescriptionSupplyMode, string> = {
  ONSITE_DISPENSE: 'Clinic dispenses',
  EXTERNAL_PRESCRIPTION: 'External prescription',
  PATIENT_OWN_SUPPLY: 'Patient’s own supply',
  DEFERRED: 'Supply deferred',
  NO_SUPPLY_REQUIRED: 'No supply required',
};

/** The source's own clinical/operational status, in counter language. */
export function sourceStatusLabel(item: BillingWorklistItem): string | null {
  if (!item.sourceStatus) return null;
  const map: Record<string, string> = {
    ORDERED: 'Ordered',
    DISPENSED: 'Dispensed',
    PENDING: 'Pending',
    IN_PROGRESS: 'In progress',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
  };
  return map[item.sourceStatus] ?? item.sourceStatus;
}

export const VERIFICATION_LABEL: Record<PanelVerificationStatus, string> = {
  PENDING_VERIFICATION: 'Not yet verified',
  VERIFIED: 'Verified',
  FAILED: 'Verification failed',
  OVERRIDDEN: 'Overridden by finance',
};

export const VERIFICATION_COLOR: Record<PanelVerificationStatus, string> = {
  PENDING_VERIFICATION: 'gold',
  VERIFIED: 'green',
  FAILED: 'red',
  OVERRIDDEN: 'purple',
};

export const COVERAGE_LABEL: Record<PanelCoverageType, string> = {
  UNLIMITED: 'Unlimited coverage',
  VISIT_LIMIT: 'Visit limit',
};

export const COPAYMENT_LABEL: Record<PanelCopaymentType, string> = {
  NONE: 'No copayment',
  FIXED_AMOUNT: 'Fixed copayment',
  PERCENTAGE: 'Percentage copayment',
};

export const CLASSIFICATION_LABEL: Record<VisitClassification, string> = {
  CONSULTATION: 'Consultation visit',
  OTC_ONLY: 'OTC purchase only',
  DRESSING_ONLY: 'Dressing only',
  PROCEDURE_ONLY: 'Procedure only',
  FOLLOW_UP_NO_CONSULTATION: 'Follow-up — no consultation fee',
};

/**
 * The owner's approved waiver reasons. "Other" requires free text, so a
 * waiver never records a shrug.
 */
export const WAIVER_REASONS = [
  'OTC purchase only',
  'Dressing-only visit',
  'Procedure-only visit',
  'Follow-up — no consultation fee',
  'Complimentary',
  'Billing correction',
  'Other',
] as const;

export const OTHER_REASON = 'Other';

/**
 * Patient-facing payment method wording. PANEL says only that the PATIENT
 * owes nothing — never that the panel has paid the clinic, which is Finance /
 * Panel & Claims' business and a different fact entirely.
 */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  QR: 'QR Payment',
  BANK_TRANSFER: 'Bank Transfer',
  PANEL: 'Panel — No Patient Payment',
};

export const PATIENT_PAYMENT_METHODS = ['CASH', 'CARD', 'QR', 'BANK_TRANSFER'] as const;

/**
 * Counter-facing blocker wording, with WHO resolves it and WHERE. A blocker
 * without a remediation is exactly what the 3b0 audit called unacceptable.
 */
export interface BlockerGuidance {
  title: string;
  who: string;
  action: string;
}

export const BLOCKER_GUIDANCE: Record<string, BlockerGuidance> = {
  DOCTOR_PHASE_NOT_COMPLETED: {
    title: 'The doctor consultation phase has not been completed.',
    who: 'Attending doctor',
    action: 'The doctor completes their phase from the clinical workspace.',
  },
  PROCEDURE_PENDING: {
    title: 'A procedure is still pending or in progress.',
    who: 'Clinical staff',
    action: 'Complete or cancel the procedure in the procedure queue. Counter staff must not mark it done.',
  },
  MEDICATION_SUPPLY_UNCONFIRMED: {
    title: 'Medication supply mode must be confirmed.',
    who: 'Prescriber',
    action: 'The prescriber sets how each medication is supplied.',
  },
  MEDICATION_SUPPLY_DEFERRED: {
    title: 'Deferred medication supply must be resolved.',
    who: 'Prescriber',
    action: 'The prescriber confirms the final supply mode.',
  },
  DISPENSING_PENDING: {
    title: 'Medication dispensing is not complete.',
    who: 'Dispensary',
    action: 'Dispense the medication; the charge is finalised from what is actually supplied.',
  },
  BILLING_REVIEW_REQUIRED: {
    title: 'Billing responsibility has not been confirmed.',
    who: 'Counter or finance staff',
    action: 'Confirm the panel benefit below so panel and patient responsibility can be calculated.',
  },
  PATIENT_BALANCE_REMAINING: {
    title: 'Patient payment is still outstanding.',
    who: 'Counter staff',
    action: 'Record the patient payment below.',
  },
  UNBILLED_CHARGEABLE_ITEMS: {
    title: 'Billing contains items that have not been invoiced.',
    who: 'Counter staff',
    action: 'Add each ready item from the billing worklist.',
  },
  CONSULTATION_TARIFF_REVIEW_REQUIRED: {
    title: 'Consultation tariff requires review.',
    who: 'Finance staff or the clinic owner',
    action: 'Configure a consultation tariff covering this time in Clinic Settings, or record the visit as exempt.',
  },
  QUEUE_STATE_INELIGIBLE: {
    title: 'This visit is not at a stage where it can be completed.',
    who: 'Counter staff',
    action: 'The visit must reach dispensary or payment before it can be completed.',
  },
};

export function blockerGuidance(code: string, fallbackMessage: string): BlockerGuidance {
  return (
    BLOCKER_GUIDANCE[code] ?? {
      title: fallbackMessage,
      who: 'Counter staff',
      action: 'Review this visit before completing it.',
    }
  );
}
