import { VisitAttachmentCategory } from '@prisma/client';
import { IsEnum, IsInt, IsOptional } from 'class-validator';
import { MustNotBeProvided } from './must-not-be-provided.validator';

// b0 — re-filing an attachment under a different kind (photo | lab | letter).
//
// A closed enum rather than a string: the tag is how a later reader finds a
// lab result in a two-year-old visit, and an open vocabulary produces "lab",
// "Lab", "bloods" and "FBC" in one clinic within a month.
export class SetAttachmentCategoryDto {
  @IsEnum(VisitAttachmentCategory, {
    message: 'category must be one of PHOTO, LAB, LETTER.',
  })
  category!: VisitAttachmentCategory;

  @IsOptional()
  @IsInt()
  expectedVersion?: number;

  // Declared so the whitelisting pipe keeps them and the validator answers
  // with a 400 rather than stripping them in silence. Who filed a file comes
  // from the authenticated session — never from the browser.
  @IsOptional()
  @MustNotBeProvided()
  categorySetByStaffId?: never;

  @IsOptional()
  @MustNotBeProvided()
  categorySetAt?: never;
}
