import { IsInt, IsOptional } from 'class-validator';
import { MustNotBeProvided } from './must-not-be-provided.validator';

/**
 * G3b — the sign request carries no identity at all.
 *
 * It used to require `staffId`, and the browser sent the VISIT's attending
 * doctor regardless of who actually clicked. Signer identity now comes from
 * the authenticated session; `staffId` is declared here only so the
 * whitelisting pipe keeps it and it fails with 400 rather than being
 * silently stripped.
 */
export class SignDocumentDto {
  @IsOptional()
  @IsInt()
  expectedVersion?: number;

  @IsOptional()
  @MustNotBeProvided()
  staffId?: never;

  @IsOptional()
  @MustNotBeProvided()
  signedByStaffId?: never;

  @IsOptional()
  @MustNotBeProvided()
  signedAt?: never;
}
