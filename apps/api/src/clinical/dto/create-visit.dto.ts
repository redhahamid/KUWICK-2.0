import { PanelRelationship } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

// Standalone Visit creation, independent of the Queue flow — the Patient
// Dashboard's "New Visit" entry point (a patient with no queue ticket, e.g.
// a follow-up consult, still needs a medical record to write into).
export class CreateVisitDto {
  @IsUUID()
  clinicId!: string;

  @IsUUID()
  patientId!: string;

  @IsUUID()
  staffId!: string;

  @IsString()
  @MinLength(1)
  billingType!: string;

  @IsOptional()
  @IsUUID()
  panelClinicId?: string;

  /**
   * N-5 — THE EMPLOYER BEHIND THE PANEL, and who the patient is to the member.
   *
   * The employer must belong to the panel chosen above; `VisitService` checks
   * that rather than trusting the pair. An employer from a different panel is
   * a different agreement, and its payment term would then be applied to this
   * claim (G-9) — a wrong due date arrived at by two correct-looking ids.
   */
  @IsOptional()
  @IsUUID()
  panelEmployerId?: string;

  @IsOptional()
  @IsEnum(PanelRelationship)
  panelRelationship?: PanelRelationship;

  /** The membership or card number, as printed on the patient's card. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  panelMemberReference?: string;

  @IsOptional()
  @IsString()
  presentingComplaint?: string;
}
