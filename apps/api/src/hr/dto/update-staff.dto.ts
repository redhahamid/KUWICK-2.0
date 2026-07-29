import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
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

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
