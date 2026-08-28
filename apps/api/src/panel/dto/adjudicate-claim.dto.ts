import { IsISO8601, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const MONEY = /^\d{1,8}(\.\d{1,2})?$/;

export class AdjudicateClaimDto {
  /** What the panel agreed to pay. Zero is a full rejection, not a missing value. */
  @Matches(MONEY)
  approvedAmount!: string;

  @IsOptional()
  @Matches(MONEY)
  rejectedAmount?: string;

  /** Required by the SERVICE whenever anything was rejected. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;

  @IsOptional()
  @IsISO8601()
  adjudicatedAt?: string;

  /** The panel's own claim number, if it was issued at adjudication. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  panelClaimNo?: string;
}
