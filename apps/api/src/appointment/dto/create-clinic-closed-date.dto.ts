import { IsBoolean, IsOptional, IsString, MaxLength, Matches } from 'class-validator';

export class CreateClinicClosedDateDto {
  /** YYYY-MM-DD, in the clinic's own zone. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be written as YYYY-MM-DD.' })
  date!: string;

  /** Shown to patients on the public booking page ("Deepavali"). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reason?: string;

  /**
   * Whether a PATIENT may read that reason. Opt-in: a clinic closing for a
   * reason it would rather not publish must still be able to close.
   */
  @IsOptional()
  @IsBoolean()
  reasonIsPublic?: boolean;
}
