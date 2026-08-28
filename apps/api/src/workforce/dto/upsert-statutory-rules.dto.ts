import { IsBoolean, IsISO8601, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Statutory rate tables, as the TENANT enters them.
 *
 * The tables are JSON because their shape differs per scheme and changes by law
 * on dates nobody can predict — encoding them as columns would mean a migration
 * every budget. Nothing here is validated against a published table, and the
 * system never claims it was: `verified` is a human assertion that somebody
 * checked, and it is cleared whenever the rates are edited.
 */
export class UpsertStatutoryRulesDto {
  @IsOptional() @IsUUID() id?: string;

  @IsString() @MaxLength(120) name!: string;

  @IsOptional() @IsString() @MaxLength(8) jurisdiction?: string;

  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;

  @IsOptional() @IsObject() epfRules?: Record<string, unknown>;
  @IsOptional() @IsObject() socsoRules?: Record<string, unknown>;
  @IsOptional() @IsObject() eisRules?: Record<string, unknown>;
  @IsOptional() @IsObject() pcbRules?: Record<string, unknown>;

  /** Somebody checked these against the authority's published tables. */
  @IsOptional() @IsBoolean() verified?: boolean;
  @IsOptional() @IsString() @MaxLength(500) verificationNote?: string;
}
