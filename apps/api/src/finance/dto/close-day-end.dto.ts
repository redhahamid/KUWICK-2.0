import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CloseDayEndDto {
  /**
   * Required by the SERVICE when the variance is non-zero, not by this DTO —
   * because whether it is required depends on a number the client does not
   * own. The server refuses the close and says by how much.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  varianceReason?: string;
}
