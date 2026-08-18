import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * The BOOKING half of a service, kept apart from `UpdateServiceDto`.
 *
 * Not tidiness: the two are edited by different people for different reasons.
 * A clinical lead renames a service and changes its price; whoever runs the
 * public booking page decides whether patients can see it, what it costs to
 * hold a slot, and how many rooms there are. Splitting them means the booking
 * form cannot accidentally carry a price change, and a price change cannot
 * accidentally publish a service.
 */
export class UpdateServiceBookingDto {
  /** Whether a patient may book this at all. */
  @IsOptional()
  @IsBoolean()
  bookable?: boolean;

  /**
   * How long the appointment runs. Shared with the clinical record on
   * purpose — a 30-minute consultation is 30 minutes whoever asks.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60 * 12)
  durationMinutesDefault?: number;

  /** How often a slot starts. Null means "same as the duration". */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60 * 12)
  slotIntervalMinutes?: number | null;

  /** RM. Zero is a real answer and the common one. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  bookingFee?: number;

  /** The sentence a patient reads under the service name. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bookingDescription?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  bookingPhotoUrl?: string | null;

  /** True sends the booking to the Requests tab instead of confirming it. */
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  /** How many can run at once across the clinic. Null means unlimited. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  concurrentLimit?: number | null;
}
