import { IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class PayrollAdjustmentDto {
  @IsUUID() staffId!: string;

  @IsString() @MaxLength(200) description!: string;

  /** SIGNED — a negative amount is a deduction. */
  @Matches(/^-?\d{1,10}(\.\d{1,2})?$/, { message: 'An adjustment is a signed amount.' })
  amount!: string;

  @IsString()
  @MinLength(5, { message: 'Say why this payroll adjustment is being made.' })
  @MaxLength(500)
  reason!: string;
}
