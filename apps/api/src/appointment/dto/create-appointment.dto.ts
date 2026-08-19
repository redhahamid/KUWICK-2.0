import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AppointmentSource } from '@prisma/client';

export class CreateAppointmentDto {
  @IsUUID()
  clinicId!: string;

  @IsUUID()
  patientId!: string;

  @IsUUID()
  staffId!: string;

  @IsUUID()
  serviceId!: string;

  @IsEnum(AppointmentSource)
  source!: AppointmentSource;

  @IsDateString()
  scheduledStart!: string;

  @IsDateString()
  scheduledEnd!: string;

  /** INTERNAL note. Never shown to the patient. */
  @IsOptional()
  @IsString()
  notes?: string;

  /** What the patient said, or a note written for them. Safe to show back. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  patientNote?: string;

  /** Campaign, referrer, UTM — free text, so a campaign is never a migration. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceDetail?: string;

  /**
   * §28 — the caller's own id for THIS booking attempt. A double click, a
   * network retry and a payment-callback retry all send the same value, and
   * the server returns the appointment it already made rather than a second
   * one. Optional: a caller that does not supply one gets today's behaviour.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;

  /**
   * §16 — deliberately set the clinic's scheduling rules aside. Requires
   * `appointment.override`, requires a reason, and is recorded on the
   * appointment with the actor's name. It can never bypass approved leave, a
   * closed branch or a provider who is not qualified — see
   * OVERRIDABLE_REASONS.
   */
  @IsOptional()
  @IsBoolean()
  override?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  overrideReason?: string;
}
