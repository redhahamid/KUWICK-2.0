import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BookingFieldType, ServiceBookingPaymentRule, ServicePriceDisplay } from '@prisma/client';

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class ServiceBookableHourDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @Matches(TIME)
  startTime!: string;

  @Matches(TIME)
  endTime!: string;
}

export class BookingFormFieldDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MaxLength(200)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  helpText?: string;

  @IsEnum(BookingFieldType)
  fieldType!: BookingFieldType;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];
}

/**
 * The whole service editor in one payload — Basic, Scheduling, Providers,
 * Patient Form, Payment & Policies, Instructions and Sharing.
 *
 * One request rather than seven, because the tabs are one form to the person
 * filling them in: they press Save once and expect all of it to land or none
 * of it to. Seven endpoints is how a service ends up with its new duration and
 * its old provider list.
 */
export class UpdateServiceBookingConfigDto {
  // --- Basic ---------------------------------------------------------------
  @IsOptional()
  @IsBoolean()
  bookable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bookingDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bookingPhotoUrl?: string;

  @IsOptional()
  @IsEnum(ServicePriceDisplay)
  priceDisplay?: ServicePriceDisplay;

  // --- Scheduling ----------------------------------------------------------
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(60 * 12)
  durationMinutesDefault?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(60 * 12)
  slotIntervalMinutes?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  bufferBeforeMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  bufferAfterMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  concurrentLimit?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60 * 24 * 90)
  minimumNoticeMinutes?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(730)
  maxAdvanceDays?: number | null;

  /** TRUE = the booking lands in Requests for a human to accept. */
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceBookableHourDto)
  bookableHours?: ServiceBookableHourDto[];

  // --- Providers -----------------------------------------------------------
  /** The complete list of providers who may perform this. Replaces, not adds. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  providerStaffIds?: string[];

  // --- Patient form --------------------------------------------------------
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingFormFieldDto)
  formFields?: BookingFormFieldDto[];

  // --- Payment & policies --------------------------------------------------
  @IsOptional()
  @IsEnum(ServiceBookingPaymentRule)
  bookingPaymentRule?: ServiceBookingPaymentRule;

  @IsOptional()
  @IsNumber()
  @Min(0)
  depositAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bookingFee?: number;

  // --- Instructions --------------------------------------------------------
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  preInstructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  postInstructions?: string;

  // --- Sharing -------------------------------------------------------------
  /** The tail of a service-specific public link: /hijraa-bangi/sinus. */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'A link ending may contain lowercase letters, numbers and hyphens only.',
  })
  @MaxLength(60)
  bookingSlug?: string | null;
}
