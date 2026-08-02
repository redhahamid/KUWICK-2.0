import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { ProfessionalType, Role } from '@prisma/client';

export class UpdateStaffDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @IsOptional()
  @IsString()
  staffNumber?: string;

  // D-045 — home branch; null clears it back to "works across every
  // clinic". class-validator's @IsOptional lets null/undefined through,
  // so an explicit `clinicId: null` in the request body clears it.
  @IsOptional()
  @IsUUID()
  clinicId?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // C0 (D-051) — professional (clinical) identity. The verification and
  // signing-enable TIMESTAMPS are deliberately absent: StaffService stamps
  // them (with the acting staff member) when these flags flip, so they can't
  // be forged by the client.
  @IsOptional()
  @IsEnum(ProfessionalType)
  professionalType?: ProfessionalType;

  @IsOptional()
  @IsString()
  medicalRegistrationNo?: string;

  @IsOptional()
  @IsBoolean()
  professionalActive?: boolean;

  @IsOptional()
  @IsBoolean()
  canSignClinicalNotes?: boolean;

  // Optional free-text justification recorded on the professional audit rows
  // (e.g. "sighted original MMC certificate", "locum contract ended").
  @IsOptional()
  @IsString()
  professionalChangeReason?: string;
}
