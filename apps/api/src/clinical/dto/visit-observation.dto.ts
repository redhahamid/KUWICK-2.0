import { IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { ObservationSource } from '@prisma/client';
import { MustNotBeProvided } from './must-not-be-provided.validator';

// C0 (D-051) — vitals/anthropometry/point-of-care.
//
// No recorder fields: attribution comes from the authenticated session, never
// from the client.
export class RecordObservationDto {
  @IsOptional() @IsInt() @Min(0) bpSystolic?: number;
  @IsOptional() @IsInt() @Min(0) bpDiastolic?: number;
  @IsOptional() @IsInt() @Min(0) pulse?: number;
  @IsOptional() @IsNumber() temperature?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) spo2?: number;
  @IsOptional() @IsInt() @Min(0) respRate?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10) painScore?: number;
  @IsOptional() @IsNumber() weight?: number;
  @IsOptional() @IsNumber() height?: number;
  // Present in the schema since Phase 3a but never had an input field before
  // C0 — recordable at last.
  @IsOptional() @IsNumber() headCircumference?: number;
  @IsOptional() @IsNumber() glucose?: number;

  @IsOptional()
  @IsEnum(ObservationSource)
  source?: ObservationSource;

  // Declared so that supplying recorder identity is a loud 400 rather than a
  // silent strip — it always comes from the authenticated session.
  @MustNotBeProvided()
  recordedByStaffId?: never;

  @MustNotBeProvided()
  recorderNameSnapshot?: never;
}

// Correcting an inaccurate reading — distinct from recording a repeat
// reading, which is a new row via RecordObservationDto.
export class CorrectObservationDto extends RecordObservationDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsString()
  @IsNotEmpty({ message: 'A correction requires a reason' })
  correctionReason!: string;
}
