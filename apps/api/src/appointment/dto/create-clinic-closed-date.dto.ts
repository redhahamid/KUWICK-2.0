import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';

export class CreateClinicClosedDateDto {
  /** YYYY-MM-DD, in the clinic's own zone. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be written as YYYY-MM-DD.' })
  date!: string;

  /** Shown to patients on the public booking page ("Deepavali"). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reason?: string;
}
