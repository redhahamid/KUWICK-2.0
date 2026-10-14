import { IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreatePublicHolidayDto {
  @IsDateString()
  date!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  /** ORDINARY unless said otherwise; FESTIVE lets a rule set price the day apart. */
  @IsOptional()
  @IsIn(['ORDINARY', 'FESTIVE'])
  kind?: 'ORDINARY' | 'FESTIVE';

  /** The clinic's multiplier for hours on this holiday (decision 2). Blank is the rule set's. */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  multiplier?: number | null;
}
