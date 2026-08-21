import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CommunicationChannel, RecurrenceFrequency, WaitlistStatus } from '@prisma/client';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class UpsertBookingPageDto {
  @IsUUID()
  clinicId!: string;

  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'A booking link may contain lowercase letters, numbers and hyphens only.',
  })
  @MaxLength(60)
  slug!: string;

  @IsString()
  @MaxLength(120)
  displayName!: string;

  @IsOptional() @IsString() @MaxLength(500) logoUrl?: string;
  @IsOptional() @IsString() @MaxLength(8) language?: string;
  @IsOptional() @IsString() @MaxLength(2000) introText?: string;
  @IsOptional() @IsBoolean() requirePhone?: boolean;
  @IsOptional() @IsBoolean() requireEmail?: boolean;
  @IsOptional() @IsBoolean() requireNric?: boolean;
  @IsOptional() @IsBoolean() showReasonField?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() allowPatientReschedule?: boolean;
  @IsOptional() @IsBoolean() allowPatientCancel?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(720) patientChangeCutoffHours?: number;
  /** Phase 7 — tri-state policies; REQUEST_APPROVAL is the recommended clinic workflow. */
  @IsOptional() @IsIn(['NOT_ALLOWED', 'REQUEST_APPROVAL', 'INSTANT'])
  patientRescheduleMode?: 'NOT_ALLOWED' | 'REQUEST_APPROVAL' | 'INSTANT';
  @IsOptional() @IsIn(['NOT_ALLOWED', 'REQUEST_APPROVAL', 'INSTANT'])
  patientCancelMode?: 'NOT_ALLOWED' | 'REQUEST_APPROVAL' | 'INSTANT';
  /** Cutoff with minute precision (value x minutes/hours/days in the UI). */
  @IsOptional() @IsInt() @Min(0) @Max(43200) patientChangeCutoffMinutes?: number;
  @IsOptional() @IsString() @MaxLength(1000) confirmationMessage?: string;
}

export class CreateWaitlistEntryDto {
  @IsUUID() clinicId!: string;
  @IsUUID() patientId!: string;
  @IsUUID() serviceId!: string;

  @IsOptional() @IsUUID() preferredStaffId?: string;
  @IsOptional() @Matches(DATE) earliestDate?: string;
  @IsOptional() @Matches(DATE) latestDate?: string;

  /** MORNING | AFTERNOON | EVENING | ANY, or whatever the clinic calls it. */
  @IsOptional() @IsString() @MaxLength(40) preferredDaypart?: string;

  /** Raising this needs `appointment.override`. */
  @IsOptional() @IsInt() @Min(0) @Max(100) priority?: number;

  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateWaitlistEntryDto {
  @IsOptional() @IsEnum(WaitlistStatus) status?: WaitlistStatus;
  @IsOptional() @IsInt() @Min(0) @Max(100) priority?: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class CreateSeriesDto {
  @IsUUID() clinicId!: string;
  @IsUUID() patientId!: string;
  @IsUUID() staffId!: string;
  @IsUUID() serviceId!: string;

  @IsEnum(RecurrenceFrequency) frequency!: RecurrenceFrequency;

  /** For CUSTOM_DAYS. Ignored otherwise. */
  @IsOptional() @IsInt() @Min(1) @Max(365) intervalDays?: number;

  @IsInt() @Min(2) @Max(52) occurrences!: number;

  /** The FIRST session. Every later one is computed from it. */
  @IsString() firstStart!: string;
  @IsString() firstEnd!: string;

  @IsOptional() @IsString() @MaxLength(500) notes?: string;

  /**
   * Book the occurrences the engine can honour and REPORT the ones it cannot,
   * rather than refusing the whole course because week six is a holiday.
   */
  @IsOptional() @IsBoolean() skipUnavailable?: boolean;
}

export class LogCommunicationDto {
  @IsEnum(CommunicationChannel) channel!: CommunicationChannel;

  /** 'CONFIRMATION' | 'REMINDER_24H' | 'CANCELLED' | … */
  @IsString() @MaxLength(60) template!: string;

  @IsOptional() @IsString() @MaxLength(200) destination?: string;
}

export class UpsertReminderRulesDto {
  @IsUUID() clinicId!: string;

  @IsOptional() @IsUUID() serviceId?: string;

  /** Minutes before the appointment. 1440 = a day. Empty = no reminders. */
  @IsArray()
  @IsInt({ each: true })
  offsets!: number[];

  @IsOptional() @IsEnum(CommunicationChannel) channel?: CommunicationChannel;
}
