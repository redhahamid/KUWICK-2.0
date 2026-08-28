import { IsISO8601, Matches } from 'class-validator';

export class AddTaxRateDto {
  /** Three decimal places, matching `Decimal(6,3)` on the column. */
  @Matches(/^\d{1,3}(\.\d{1,3})?$/, { message: 'A rate is a percentage with up to three decimal places.' })
  ratePercent!: string;

  @IsISO8601()
  effectiveFrom!: string;
}
