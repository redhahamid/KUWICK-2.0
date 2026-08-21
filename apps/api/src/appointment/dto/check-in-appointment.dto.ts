import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * PHASE 4 — CHECK-IN IS A REGISTRATION, NOT A KEYSTROKE.
 *
 * The registration drawer reviews patient, doctor, payer and remarks before
 * anything is created, and this carries what the front desk decided. Every
 * field is optional: an empty body is the old one-click behaviour exactly
 * (self-pay, the booked doctor, the patient's own note as the complaint), so
 * nothing that already worked changes shape.
 */
export class CheckInAppointmentDto {
  /**
   * The ATTENDING clinician for the visit, when the desk assigns somebody
   * other than the booked provider (Dr A called in sick, Dr B is taking her
   * list). The appointment keeps its booked provider — this is who actually
   * sees the patient.
   */
  @IsOptional()
  @IsUUID()
  staffId?: string;

  /** "Self-pay" or the panel's own name — same values the walk-in flow uses. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  billingType?: string;

  @IsOptional()
  @IsUUID()
  panelClinicId?: string;

  /** Registration remarks; defaults to the patient's own booking note. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  presentingComplaint?: string;
}
