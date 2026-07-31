import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Portal/Courier/Email/Other captures the real per-panel variance (AIA's
// own portal, MARA's manual courier, etc.) as data, not as a per-panel code
// branch (D-031).
const SUBMISSION_METHODS = ['PORTAL', 'COURIER', 'EMAIL', 'OTHER'];

export class SubmitClaimBatchDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(SUBMISSION_METHODS)
  submissionMethod!: string;

  @IsOptional()
  @IsString()
  submissionReference?: string;
}
