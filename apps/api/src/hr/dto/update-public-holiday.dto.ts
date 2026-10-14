import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

/** A holiday's name or kind, after the fact; the date is the row's identity and is not moved. */
export class UpdatePublicHolidayDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsIn(['ORDINARY', 'FESTIVE']) kind?: 'ORDINARY' | 'FESTIVE';
  /** Null clears it back to the rule set's. */
  @IsOptional() @IsNumber() @Min(1) @Max(10) multiplier?: number | null;
}
