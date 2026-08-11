import { IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { MustNotBeProvided } from './must-not-be-provided.validator';

// G2 closure (D-061) — removing a saved diagnosis from the active record.
//
// The reason is MANDATORY and non-trivial. A correction to a medicolegal
// record that says nothing about why it was made is barely better than the
// hard delete it replaces.
export class RemoveDiagnosisDto {
  @IsString()
  @MinLength(3, { message: 'A removal reason is required — say why this diagnosis is being removed.' })
  removalReason!: string;

  // Optimistic concurrency: the version the client last read. Omitted is
  // allowed (an older client), but supplying a stale one is a 409.
  @IsOptional()
  @IsInt()
  expectedVersion?: number;

  // Declared so the global whitelisting pipe keeps them and the validator can
  // reject them with a 400 rather than stripping them silently — the remover's
  // identity comes from the authenticated session, never the browser.
  @IsOptional()
  @MustNotBeProvided()
  removedByStaffId?: never;

  @IsOptional()
  @MustNotBeProvided()
  removedByNameSnapshot?: never;

  @IsOptional()
  @MustNotBeProvided()
  removedByRoleSnapshot?: never;

  @IsOptional()
  @MustNotBeProvided()
  removedAt?: never;

  @IsOptional()
  @MustNotBeProvided()
  recordStatus?: never;
}
