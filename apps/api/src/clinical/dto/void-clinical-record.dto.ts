import { IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { MustNotBeProvided } from './must-not-be-provided.validator';

// G3a (D-062) — one DTO shape for voiding a document and for removing a
// clinical attachment. The reason is MANDATORY: a correction to a medicolegal
// record that says nothing about why is barely better than the hard delete it
// replaces.
export class VoidClinicalRecordDto {
  @IsString()
  @MinLength(3, { message: 'A reason is required — say why this record is being voided or removed.' })
  reason!: string;

  @IsOptional()
  @IsInt()
  expectedVersion?: number;

  // Declared so the global whitelisting pipe keeps them and the validator can
  // reject them with a 400 rather than stripping them silently. The actor
  // comes from the authenticated session, never the browser.
  @IsOptional()
  @MustNotBeProvided()
  voidedByStaffId?: never;

  @IsOptional()
  @MustNotBeProvided()
  removedByStaffId?: never;

  @IsOptional()
  @MustNotBeProvided()
  voidedByNameSnapshot?: never;

  @IsOptional()
  @MustNotBeProvided()
  removedByNameSnapshot?: never;

  @IsOptional()
  @MustNotBeProvided()
  recordStatus?: never;
}
