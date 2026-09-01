import { IsBoolean, IsIn, IsOptional } from 'class-validator';

/**
 * WHO IS ALLOWED TO APPROVE PAYROLL.
 *
 * Both fields optional so a screen can change one without restating the other
 * — turning the owner exemption off is a decision on its own, independent of
 * which approval rule is in force.
 */
export class SetApprovalPolicyDto {
  @IsOptional()
  @IsIn(['STANDARD', 'MAKER_CHECKER', 'DUAL_APPROVAL'])
  mode?: 'STANDARD' | 'MAKER_CHECKER' | 'DUAL_APPROVAL';

  @IsOptional()
  @IsBoolean()
  allowOwnerSelfApproval?: boolean;
}
