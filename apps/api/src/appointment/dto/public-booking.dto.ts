import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PublicAnswerDto {
  @IsUUID()
  fieldId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  answer?: string;
}

export class PublicBookDto {
  @IsUUID()
  serviceId!: string;

  /** Absent = "any available provider". A real provider is still persisted. */
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsString()
  scheduledStart!: string;

  @IsString()
  scheduledEnd!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  /** NRIC or passport. Never echoed back, never confirmed to exist. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  identifier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PublicAnswerDto)
  answers?: PublicAnswerDto[];

  /** Campaign or referrer, from the link the patient followed. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceDetail?: string;

  /** §28 — the browser's own id for this attempt, so a retry is not a second booking. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}

export class PublicRescheduleDto {
  @IsString()
  scheduledStart!: string;

  @IsString()
  scheduledEnd!: string;
}

export class PublicCancelDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Phase 7 — the patient's request for the clinic to decide. */
export class PublicChangeRequestDto {
  @IsIn(['RESCHEDULE', 'CANCELLATION'])
  type!: 'RESCHEDULE' | 'CANCELLATION';

  /** Required — a request without a reason is a decision nobody can make. */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  scheduledStart?: string;

  @IsOptional()
  @IsString()
  scheduledEnd?: string;
}
