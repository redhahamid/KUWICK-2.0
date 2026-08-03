import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * G4.5d3c-2b (D-087) — close a visit.
 *
 * No checkOutAt field: the timestamp is server time. A caller supplying when
 * the patient left would be asserting a fact about the clinic's day.
 */
export class CompleteVisitDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  correlationId?: string;
}
