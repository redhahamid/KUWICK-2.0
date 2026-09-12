import { IsBoolean, IsOptional, Length, Matches } from 'class-validator';

export class SaveClaimPolicyDto {
  /** RM per kilometre, as a decimal string like every other money field. */
  @IsOptional() @Matches(/^\d{1,3}(\.\d{1,2})?$/, { message: 'The mileage rate is RM per km, like 0.60.' })
  mileageRatePerKm?: string;
  @IsOptional() @IsBoolean() receiptRequired?: boolean;
  @IsOptional() @Length(3, 500) reason?: string;
}
