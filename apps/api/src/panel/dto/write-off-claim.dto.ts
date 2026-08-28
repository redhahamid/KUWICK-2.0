import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class WriteOffClaimDto {
  /** Omit to write off whatever is still outstanding. */
  @IsOptional()
  @Matches(/^\d{1,8}(\.\d{1,2})?$/)
  amount?: string;

  @IsString()
  @MinLength(5, { message: 'Say why this receivable is being abandoned.' })
  @MaxLength(500)
  reason!: string;
}
