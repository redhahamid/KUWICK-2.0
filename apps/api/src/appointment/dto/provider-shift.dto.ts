import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ProviderScheduleMode, ProviderShiftType } from '@prisma/client';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class CreateProviderShiftDto {
  @IsUUID()
  clinicId!: string;

  @IsUUID()
  staffId!: string;

  /**
   * The clinic-local dates this shift falls on, one row each. An array rather
   * than a single date because the roster screen's normal act is "select the
   * whole of next week and give them the late shift" — sending seven requests
   * for one intention is how a half-written week happens.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(62)
  @Matches(DATE, { each: true, message: 'Dates must be written as YYYY-MM-DD.' })
  dates!: string[];

  /** Wall clock in the clinic's zone. An end at or before the start is an OVERNIGHT shift. */
  @Matches(TIME, { message: 'Times must be written as HH:MM, e.g. 09:00.' })
  startTime!: string;

  @Matches(TIME, { message: 'Times must be written as HH:MM, e.g. 09:00.' })
  endTime!: string;

  @IsOptional()
  @IsEnum(ProviderShiftType)
  shiftType?: ProviderShiftType;

  /** Appointment hours narrower than the working hours. Both, or neither. */
  @IsOptional()
  @Matches(TIME)
  bookableStartTime?: string;

  @IsOptional()
  @Matches(TIME)
  bookableEndTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  /**
   * The shift template this is rostered from (UAT, 14 October 2026). Its
   * times win over startTime/endTime, and its break and night flag are copied
   * onto the shift; an OFF template makes the day OFF.
   */
  @IsOptional()
  @IsUUID()
  templateId?: string;

  /**
   * Replace whatever is already on those dates for this provider rather than
   * adding beside it. The roster screen's "OFF" button means this; "add a
   * second shift" does not.
   */
  @IsOptional()
  replaceExisting?: boolean;
}

export class UpdateProviderShiftDto {
  /** Re-roster from a template; null keeps the times and drops the template. */
  @IsOptional()
  @ValidateIf((o) => o.templateId !== null)
  @IsUUID()
  templateId?: string | null;

  @IsOptional()
  @Matches(TIME)
  startTime?: string;

  @IsOptional()
  @Matches(TIME)
  endTime?: string;

  @IsOptional()
  @IsEnum(ProviderShiftType)
  shiftType?: ProviderShiftType;

  @IsOptional()
  @Matches(TIME)
  bookableStartTime?: string;

  @IsOptional()
  @Matches(TIME)
  bookableEndTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class CopyRosterDto {
  @IsUUID()
  clinicId!: string;

  /** YYYY-MM — the month to copy FROM. */
  @Matches(/^\d{4}-\d{2}$/)
  fromMonth!: string;

  @Matches(/^\d{4}-\d{2}$/)
  toMonth!: string;

  /** Absent = every provider with shifts in the source month. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  staffIds?: string[];
}

export class SetScheduleModeDto {
  @IsUUID()
  staffId!: string;

  @IsEnum(ProviderScheduleMode)
  mode!: ProviderScheduleMode;

  /**
   * The clinic-local date this mode starts governing. Today or later — the
   * service refuses the past, because re-deciding history would change what
   * every already-given availability answer meant (and the database trigger
   * refuses it even if the service is bypassed).
   */
  @Matches(DATE, { message: 'Effective date must be written as YYYY-MM-DD.' })
  effectiveFrom!: string;
}
