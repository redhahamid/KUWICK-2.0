import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { ProfessionalType, Role } from '@prisma/client';

export class CreateStaffDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsEnum(Role)
  role!: Role;

  @IsString()
  @MinLength(1)
  fullName!: string;

  @IsOptional()
  @IsString()
  staffNumber?: string;

  // D-045 — home branch. Null/omitted = works across every clinic in the
  // tenant (owner/finance/HR-type roles); set = every clinic-scoped screen
  // auto-resolves to this clinic for them.
  @IsOptional()
  @IsUUID()
  clinicId?: string;

  // Login credentials (D-034) — optional: a staff record can exist without
  // ever being able to log in. Both must be given together to provision one.
  @IsOptional()
  @IsEmail()
  loginEmail?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  loginPassword?: string;

  // C0 (D-051) — professional (clinical) identity, separate from `role`.
  // Signing eligibility additionally requires the verification and
  // signing-enable timestamps, which the service stamps server-side when a
  // Clinic Group records them; they are never accepted from the client.
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
}
