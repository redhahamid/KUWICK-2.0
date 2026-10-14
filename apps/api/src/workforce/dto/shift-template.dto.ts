import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { ShiftGroup, ShiftTemplateKind } from '@prisma/client';

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A clinic-defined shift (UAT, 14 October 2026). Every value is the clinic's. */
export class SaveShiftTemplateDto {
  @IsEnum(ShiftGroup) group!: ShiftGroup;

  @IsString() @MaxLength(60) name!: string;

  @IsOptional() @IsEnum(ShiftTemplateKind) kind?: ShiftTemplateKind;

  /** HH:MM; required on a working shift. An end at or before the start crosses midnight. */
  @ValidateIf((o) => o.startTime !== null) @IsOptional() @Matches(TIME, { message: 'Times are HH:MM, e.g. 08:00.' }) startTime?: string | null;
  @ValidateIf((o) => o.endTime !== null) @IsOptional() @Matches(TIME, { message: 'Times are HH:MM, e.g. 15:00.' }) endTime?: string | null;

  @IsOptional() @IsInt() @Min(0) @Max(600) breakMinutes?: number;
  @IsOptional() @IsBoolean() night?: boolean;
  /** Doctors' night pay on this template (Section C): per shift or per hour, in RM. */
  @IsOptional() @IsIn(['PER_SHIFT', 'PER_HOUR', null]) nightPayMode?: 'PER_SHIFT' | 'PER_HOUR' | null;
  @IsOptional() @Matches(/^\d{1,8}(\.\d{1,2})?$/, { message: 'Enter the night rate in ringgit, e.g. 350 or 35.' }) nightRate?: string | null;

  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'The colour is a #rrggbb value.' }) colour!: string;

  /** Omit, or null, for every branch. */
  @ValidateIf((o) => o.clinicId !== null) @IsOptional() @IsUUID() clinicId?: string | null;

  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
