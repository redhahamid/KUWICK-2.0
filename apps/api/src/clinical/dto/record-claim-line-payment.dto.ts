import { IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

// PENDING is the line's own default at creation, not a settable outcome —
// recording a payment always moves a line to one of these four terminal-ish
// states.
const SETTLEABLE_STATUSES = ['ACCEPTED', 'REJECTED', 'DEDUCTED', 'PAID'];

export class RecordClaimLinePaymentDto {
  @IsString()
  @IsIn(SETTLEABLE_STATUSES)
  status!: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  paidAmount?: number;

  @IsOptional()
  @IsString()
  deductionReason?: string;
}
