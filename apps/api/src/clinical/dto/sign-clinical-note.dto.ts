import { IsInt, Min } from 'class-validator';
import { MustNotBeProvided } from './must-not-be-provided.validator';

// C0 (D-051) — signing accepts NOTHING but the expected version.
//
// The signer is always the authenticated caller, which makes signing under
// another doctor's identity structurally impossible rather than merely
// discouraged. signedByStaffId is declared purely so that supplying it is a
// loud 400 rather than a silent strip.
export class SignClinicalNoteDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @MustNotBeProvided()
  signedByStaffId?: never;
}
