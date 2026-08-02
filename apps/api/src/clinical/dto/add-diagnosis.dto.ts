import { IsEnum, IsOptional, IsString } from 'class-validator';
import { DiagnosisPriority } from '@prisma/client';
import { MustNotBeProvided } from './must-not-be-provided.validator';

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

  // G2a — the doctor may state the clinical priority at add time. Omitted
  // means "priority not recorded", which is a legitimate state; it is never
  // silently defaulted to SECONDARY.
  @IsOptional()
  @IsEnum(DiagnosisPriority)
  priority?: DiagnosisPriority;

  // G2a (D-059) — attribution comes from the authenticated session. These are
  // DECLARED so the global whitelisting pipe keeps them and the validator can
  // reject them with a 400; left undeclared they would be silently stripped
  // and the client would believe it had set the author (the exact failure C0
  // found with authorStaffId).
  @IsOptional()
  @MustNotBeProvided()
  addedByStaffId?: never;

  @IsOptional()
  @MustNotBeProvided()
  addedByNameSnapshot?: never;

  @IsOptional()
  @MustNotBeProvided()
  addedByRoleSnapshot?: never;

  @IsOptional()
  @MustNotBeProvided()
  addedAt?: never;

  @IsOptional()
  @MustNotBeProvided()
  legacyAttributionUnknown?: never;
}
