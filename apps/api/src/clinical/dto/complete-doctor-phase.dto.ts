import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * G4.5d3c-2 (D-086) — complete the doctor's consultation phase.
 *
 * There is deliberately NO destination field. Where the patient goes next is
 * derived from stored prescriptions and invoices; accepting it here would let
 * a browser route a patient past the dispensary.
 */
export class CompleteDoctorPhaseDto {
  /** Free-text handover note, recorded on the workflow event. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** Idempotency key, so a retried completion writes one event. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  correlationId?: string;
}
