import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class EnrolPatientDto {
  @IsUUID() programmeId!: string;
  @IsUUID() patientId!: string;
  @IsOptional() @IsISO8601() enrolledAt?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
