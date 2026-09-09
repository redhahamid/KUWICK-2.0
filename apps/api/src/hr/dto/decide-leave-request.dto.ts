import { IsOptional, IsString, Length } from 'class-validator';

/**
 * WHO APPROVED IT IS NOT THE CALLER'S TO SAY.
 *
 * This carried `approvedByStaffId` — the pre-auth convention (D-017), from
 * before there was a signed-in user to read. It outlived that: any caller
 * could name ANY member of staff as the approver of any leave request, and the
 * record would say so permanently. The screen above it grew a matching
 * "Approving/Rejecting as" picker, which is how a security hole came to look
 * like a feature.
 *
 * The approver is now the actor on the session, like every other decision in
 * this product — payroll approval, incentive approval, credit notes, locum.
 */
export class DecideLeaveRequestDto {
  @IsOptional()
  @IsString()
  @Length(3, 500)
  rejectReason?: string;
}
