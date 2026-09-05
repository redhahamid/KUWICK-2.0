import { ArrayMaxSize, IsArray, IsIn, IsISO8601, IsOptional, IsString, Length } from 'class-validator';

/**
 * The employer's selected contribution basis — a dated preference.
 *
 * `reason` is required, not polite: restricting a contribution basis is a
 * decision somebody made about other people's statutory money, and the record
 * keeps their why beside their name and the date.
 */
export class RecordContributionBasisDto {
  /** Only EPF accepts an employer-selected basis today (see the model doc). */
  @IsIn(['EPF']) scheme!: 'EPF';

  @IsIn(['BASIC_ONLY', 'BASIC_PLUS_SELECTED', 'ALL_APPLICABLE'])
  mode!: 'BASIC_ONLY' | 'BASIC_PLUS_SELECTED' | 'ALL_APPLICABLE';

  /** Ticked codes under BASIC_PLUS_SELECTED; refused under the other modes. */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  includedComponentCodes?: string[];

  @IsISO8601() effectiveFrom!: string;

  @IsString() @Length(3, 500) reason!: string;

  @IsOptional() @IsString() note?: string;
}
