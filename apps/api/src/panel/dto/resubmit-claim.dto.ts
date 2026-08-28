import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class ResubmitClaimDto {
  @IsString()
  @MinLength(5, { message: 'Say why this claim is being re-claimed.' })
  @MaxLength(500)
  reason!: string;

  /**
   * What the replacement claims. Defaults to the REJECTED amount — re-claiming
   * the whole original when only part was refused would double-claim the half
   * the panel already agreed to pay.
   */
  @IsOptional()
  @Matches(/^\d{1,8}(\.\d{1,2})?$/)
  claimedAmount?: string;

  @IsOptional()
  @IsUUID()
  responsibleStaffId?: string;
}
