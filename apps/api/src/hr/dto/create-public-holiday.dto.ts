import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
}
