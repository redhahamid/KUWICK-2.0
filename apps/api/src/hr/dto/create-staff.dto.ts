import { IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
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
}
