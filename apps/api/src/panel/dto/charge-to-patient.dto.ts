import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const MONEY = /^\d{1,8}(\.\d{1,2})?$/;

/**
 * CHARGE A REJECTED CLAIM TO THE PATIENT (G-5).
 *
 * The clinic's excess register shows this as one of the four real routes out of
 * a rejection — "SELF PAY", "PT KENA BAYAR SBB OUTSTANDING AMOUNT", later a
 * payment method and a date. It is not a write-off: the money is still coming,
 * from somebody else.
 */
export class ChargeToPatientDto {
  /**
   * How much moves to the patient. Optional — defaults to the whole rejected
   * amount, because that is the case; a partial transfer is possible where the
   * clinic absorbs some of it as goodwill.
   */
  @IsOptional()
  @Matches(MONEY)
  amount?: string;

  /**
   * WHY the patient is being asked to pay. Mandatory, and at least a sentence:
   * a patient ringing up three weeks later to ask why they owe money deserves
   * an answer better than "the panel rejected it", and whoever takes that call
   * will not be the person who made this decision.
   */
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
