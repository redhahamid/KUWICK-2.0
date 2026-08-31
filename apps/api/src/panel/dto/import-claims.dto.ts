import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * A file of historical claims (G-12).
 *
 * `commit` defaults to FALSE and that is the safety rule, not a convenience:
 * an import that writes by default is an import somebody runs before reading
 * the totals. The dry run does the whole job and throws the result away.
 */
export class ImportClaimsDto {
  @IsUUID()
  panelClinicId!: string;

  /**
   * Which branch these claims came from. An imported claim has no visit, so it
   * has no branch of its own, and every branch-scoped finance screen reads the
   * branch from the visit — leave this out and the claims are invisible there.
   * Optional because a file may genuinely span branches; then they are reported
   * as not attributable rather than assigned to one.
   */
  @IsOptional()
  @IsUUID()
  clinicId?: string;

  /** The CSV itself. One panel per file — see claim-import-csv.ts. */
  @IsString()
  csv!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  /** Why this import was run, for whoever reads the batch list next year. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsBoolean()
  commit?: boolean;
}
