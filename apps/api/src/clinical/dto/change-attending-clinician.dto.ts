import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * S3b (D-081) — assign or transfer a visit's attending clinician.
 *
 * Only the target's ID crosses the wire. The target's name, role, tenant and
 * branch are resolved server-side from the stored row; a browser that sends
 * them is ignored, because a caller who can name a doctor is not thereby
 * entitled to assert that the doctor is active or works at this branch.
 */
export class ChangeAttendingClinicianDto {
  @IsString()
  staffId!: string;

  /**
   * Required by the service when an existing DOCTOR is being replaced, and
   * not when a visit is simply picked up. Validated there rather than here,
   * because whether it is required depends on stored state this DTO cannot
   * see.
   */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  correlationId?: string;
}
