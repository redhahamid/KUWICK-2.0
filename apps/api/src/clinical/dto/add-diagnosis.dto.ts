import { IsOptional, IsString } from 'class-validator';

// Either pick an existing catalog entry (diagnosisCatalogId) or type a new
// one (name, optionally with a code) — the catalog has no dedicated admin
// screen this phase, so "add" from the visit's picker is also how new
// entries get created (Clinical 2b plan, judgment call #3). At least one of
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
  code?: string;
}
