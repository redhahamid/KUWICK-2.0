import { IsEnum, IsISO8601, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { PanelSubmissionMethod } from '@prisma/client';

export class SubmitBatchDto {
  /**
   * HOW a person submitted it. Kuwick did not: no panel in the owner's list
   * exposes an API, so this records a human action that happened outside the
   * system (D-031).
   */
  @IsEnum(PanelSubmissionMethod)
  submissionMethod!: PanelSubmissionMethod;

  /** The reference the portal gave back, if it gave one. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  submissionReference?: string;

  @IsOptional()
  @IsISO8601()
  submittedAt?: string;

  /**
   * Per-claim numbers the portal issued, keyed by claim line id. Portals that
   * issue one number per claim rather than per batch — most of them — need
   * this, and it is the reference a query six months later is conducted in.
   */
  @IsOptional()
  @IsObject()
  panelClaimNumbers?: Record<string, string>;
}
