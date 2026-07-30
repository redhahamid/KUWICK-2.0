import { IsOptional, IsString, MinLength } from 'class-validator';

// Backs the Diagnoses Directory admin screen's "Add Custom Diagnosis"
// button (D-027, docs/DECISIONS.md) — always creates a CUSTOM-category
// catalog entry.
export class CreateCustomDiagnosisDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  icd10Code?: string;
}
