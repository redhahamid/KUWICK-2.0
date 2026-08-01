import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

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

  @IsOptional()
  @IsString()
  presentingComplaint?: string;
}
