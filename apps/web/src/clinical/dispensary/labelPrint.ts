import type { LabelPayload } from '../hooks/useDispensary';

/**
 * G4.5d5b-3 — laying out a medication label.
 *
 * Two rules shape this file, and both are the owner's:
 *
 *   NOTHING IS FABRICATED. The label shows what the record holds and nothing
 *   else. There is no generic name, no dosage form, no route, no structured
 *   warning block and no translated instruction, because the schema stores
 *   none of those and a label that invents them is a label that can be wrong
 *   about a medicine in a patient's hand. Where a field is absent it is
 *   omitted — never filled with a plausible default, never left as a labelled
 *   blank that reads as "none required".
 *
 *   THE SERVER COMPOSES THE CONTENT. Every string below comes from the
 *   `LabelPayload` the server assembled from the prescription. This module
 *   only decides ORDER and GROUPING; it never reads page state, and it never
 *   accepts a medication name or a set of directions from anywhere else.
 *
 * PRINTING IS NOT DISPENSING. Nothing in this file, and nothing that calls
 * it, moves stock, changes a prescription's status, moves a queue ticket or
 * touches an invoice.
 */

/**
 * The print preset.
 *
 * These are the dimensions the CSS `@page` rule and the preview both use, and
 * they are a STARTING POINT, not a hardware claim: 70 × 40 mm is a common
 * Malaysian dispensing-label stock, and the preset has been checked against
 * the browser's own print preview only. No thermal printer has been tested,
 * no printer SDK is integrated, and printing goes through the browser's
 * standard print dialog like any other page. A clinic with different stock
 * changes these two numbers — see docs/DISPENSARY_LABELS.md.
 */
export const LABEL_PRESET = {
  format: 'KUWICK_STD_70x40',
  widthMm: 70,
  heightMm: 40,
} as const;

export const MAX_LABEL_COPIES = 3;

/** Applied to <body> for the duration of a print so the print CSS can bite. */
export const PRINTING_CLASS = 'kw-printing-labels';

export interface LabelLine {
  /** Absent for the medication name and the directions — they stand alone. */
  label?: string;
  value: string;
}

export interface LabelLayout {
  /** Clinic identity, top of the label. */
  header: string;
  /** Who this is for. */
  patient: string;
  patientIdentifier: string | null;
  /** The medicine itself, largest on the label. */
  medication: string;
  /**
   * The directions, in one sentence.
   *
   * Assembled from dose, unit, frequency and duration EXACTLY as the doctor
   * wrote them. The frequency is not expanded into times of day and the
   * duration is not turned into a stop date: both would be this module
   * deciding something clinical.
   */
  directions: string;
  quantity: string;
  /** Only where the record has them. */
  extras: LabelLine[];
  /** Footer provenance — who prescribed, who printed, which visit. */
  footer: LabelLine[];
  /** Shown on the label itself so a duplicate in a bag is identifiable. */
  reprintNotice: string | null;
}

/**
 * "Take 2 Tablet (BIJI) TDS (Tiga kali sehari) for 5 days".
 *
 * b1 PHASE A — THE PATIENT'S LANGUAGE IS ON THE LABEL.
 *
 * The person holding this bottle reads Malay. Printing only "TDS" asks them to
 * know a Latin abbreviation to take their medicine correctly, which is the gap
 * the whole bilingual reference vocabulary exists to close.
 *
 * Both halves, or one honestly. Every Malay string comes from the
 * prescription's own SNAPSHOT — copied at prescribing time, never looked up
 * from the catalogue now — so a label reprinted next year says exactly what the
 * sticker on the bottle said. A prescription written before the snapshot
 * existed, or through a surface that does not use the dropdowns, simply has no
 * Malay half; it is omitted rather than printed as "TDS ()", because an empty
 * bracket on a 40mm label reads as a missing value rather than an absent one.
 *
 * The frequency is still not expanded into times of day and the duration is
 * still not turned into a stop date: both would be this module deciding
 * something clinical.
 */
export function directionsText(medication: LabelPayload['medication']): string {
  const dose = medication.doseUnit
    ? `${medication.doseAmount} ${bilingual(medication.doseUnit, medication.doseUnitBm)}`
    : medication.doseAmount;
  const parts = [`Take ${dose}`, bilingual(medication.frequency, medication.frequencyBm)];
  if (medication.durationDays > 0) {
    parts.push(`for ${medication.durationDays} ${medication.durationDays === 1 ? 'day' : 'days'}`);
  }
  return parts.filter(Boolean).join(' ');
}

/** `TDS (Tiga kali sehari)`, or just `TDS` where no Malay label was captured. */
function bilingual(clinical: string, patient: string | null): string {
  return patient ? `${clinical} (${patient})` : clinical;
}

/** The medication name, with strength appended only where the item stores one. */
export function medicationText(medication: LabelPayload['medication']): string {
  return medication.strength ? `${medication.name} ${medication.strength}` : medication.name;
}

export function buildLabelLayout(payload: LabelPayload): LabelLayout {
  const extras: LabelLine[] = [];

  // b1 PHASE A — HOW TO TAKE IT, in the language of the person taking it.
  //
  // First among the extras on purpose: "Ambil melalui mulut" is the line that
  // stops an oral suspension being used as ear drops, and it outranks both the
  // indication and the doctor's note for the patient standing at the counter.
  if (payload.medication.consumptionInstructionBm) {
    extras.push({ value: payload.medication.consumptionInstructionBm });
  }

  // Both are optional free text the doctor may have written. Absent means
  // absent: no "Indication: —" placeholder, which reads as a decision.
  if (payload.medication.indication) {
    extras.push({
      label: 'For',
      // The Malay alongside where the indication came from the catalogue.
      // Free text a doctor typed has no translation, and inventing one would
      // be this module making a clinical claim in a language it cannot check.
      value: bilingual(payload.medication.indication, payload.medication.indicationBm),
    });
  }
  if (payload.medication.remark) {
    extras.push({ label: 'Note', value: payload.medication.remark });
  }

  const footer: LabelLine[] = [
    { label: 'Prescribed by', value: payload.prescriber },
    { label: 'Printed', value: formatPrintedAt(payload.printedAt) },
    { label: 'Visit', value: payload.visitReference },
  ];
  // Only once the medication has actually been handed over. Before that the
  // field is absent rather than empty — a label is not evidence of dispensing.
  if (payload.dispensedBy) {
    footer.push({ label: 'Dispensed by', value: payload.dispensedBy });
  }

  return {
    header: payload.clinic.branch
      ? `${payload.clinic.name} — ${payload.clinic.branch}`
      : payload.clinic.name,
    patient: payload.patient.name,
    patientIdentifier: payload.patient.identifier,
    medication: medicationText(payload.medication),
    directions: directionsText(payload.medication),
    quantity: `Quantity: ${payload.medication.quantity}`,
    extras,
    footer,
    reprintNotice: payload.isReprint ? `Reprint #${payload.printSequence}` : null,
  };
}

function formatPrintedAt(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Hands the page to the browser's print dialog.
 *
 * The body class is added before and removed after, so the print stylesheet
 * (index.css) can hide the application and show only the label sheet. There
 * is no silent printer integration and no attempt to choose a printer: the
 * user sees the standard dialog, picks their label printer and can cancel.
 */
export function printLabelSheet(win: Window = window): void {
  const { body } = win.document;
  body.classList.add(PRINTING_CLASS);
  try {
    win.print();
  } finally {
    body.classList.remove(PRINTING_CLASS);
  }
}
