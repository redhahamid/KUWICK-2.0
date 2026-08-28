import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReversePaymentDto {
  /**
   * Mandatory, and long enough to be a sentence. A reversal with the reason
   * "error" is a reversal nobody can audit six months later.
   */
  @IsString()
  @MinLength(5, { message: 'Say why this payment is being reversed.' })
  @MaxLength(500)
  reason!: string;
}
