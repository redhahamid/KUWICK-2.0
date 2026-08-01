import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

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
}
