import { ArrayNotEmpty, IsArray, IsOptional, IsString } from 'class-validator';

export class CopyPrescriptionsDto {
  @IsString()
  sourceVisitId!: string;

  @IsString()
  targetVisitId!: string;

  /**
   * KW2-C2 — WHICH medications to carry over.
   *
   * Optional, and its absence means "all of them". That is not a convenience:
   * the 1.0 Medications tab has always copied a whole visit and still calls
   * this endpoint, so omitting the field has to keep meaning what it always
   * meant. The Canvas always sends a selection, because the spec is explicit
   * that a prescription is never blind-copied.
   */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  prescriptionIds?: string[];
}
