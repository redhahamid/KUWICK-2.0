import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

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
}
