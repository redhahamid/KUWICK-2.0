import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class BuildAudienceDto {
  @IsOptional() @IsUUID() clinicId?: string;
  @IsOptional() @IsUUID() panelClinicId?: string;
  @IsOptional() @IsUUID() programmeId?: string;
  @IsOptional() @IsString() @MaxLength(20) gender?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(120) minAge?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(120) maxAge?: number;

  /** Patients seen within this many days. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) visitedSinceDays?: number;
  /** Patients whose LAST visit was longer ago than this. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) lapsedForDays?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(2000) limit?: number;
}
