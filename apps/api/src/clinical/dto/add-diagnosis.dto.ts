import { IsOptional, IsString } from 'class-validator';

// Either pick an existing catalog entry (diagnosisCatalogId) or type a new
// one (name, optionally with an ICD-10 code) — typing a new one creates it
// as a CUSTOM catalog entry (D-027, docs/DECISIONS.md). At least one of
// diagnosisCatalogId/name is required — enforced in DiagnosisService, not
// here, since which one is required depends on the other.
export class AddDiagnosisDto {
  @IsString()
  visitId!: string;

  @IsOptional()
  @IsString()
  diagnosisCatalogId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  icd10Code?: string;
}
