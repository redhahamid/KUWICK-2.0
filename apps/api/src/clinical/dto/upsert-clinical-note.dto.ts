import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ClinicalNoteType, NoteLanguage } from '@prisma/client';
import { MustNotBeProvided } from './must-not-be-provided.validator';

// C0 (D-051) — the narrative payload ONLY.
//
// Vitals fields were deliberately REMOVED from this DTO: they now belong to
// VisitObservation, which carries its own recorder attribution. Keeping them
// here would let a vitals entry create a note authored by the person taking
// the reading, which is exactly the false-attribution problem C0 exists to
// fix.
//
// Author and signer fields are deliberately absent and are never accepted
// from the client — identity comes from the authenticated session only.
// `forbidNonWhitelisted` on the global ValidationPipe turns any attempt to
// send authorStaffId/signedByStaffId into a 400.
export class UpsertClinicalNoteDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(NoteLanguage)
  noteLanguage?: NoteLanguage;

  // DOCTOR_NARRATIVE (doctors only) or STAFF_REMARK (how non-doctors record
  // things like "patient refused medication"). A STAFF_REMARK can never be
  // signed — enforced in the service AND by a DB CHECK constraint.
  @IsOptional()
  @IsEnum(ClinicalNoteType)
  noteType?: ClinicalNoteType;

  // Late entry: when the clinical event actually happened, if earlier than
  // this system entry. createdAt is never backdated — both are kept.
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  clinicalEntryAt?: Date;

  @IsOptional()
  @IsString()
  lateEntryReason?: string;

  // Optimistic concurrency — required on update; ignored on create.
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;

  // Declared ONLY so that supplying them fails loudly with a 400 instead of
  // being silently stripped by the global whitelist. Identity always comes
  // from the authenticated session.
  @MustNotBeProvided()
  authorStaffId?: never;

  @MustNotBeProvided()
  signedByStaffId?: never;

  @MustNotBeProvided()
  authorNameSnapshot?: never;

  @MustNotBeProvided()
  signerNameSnapshot?: never;
}
