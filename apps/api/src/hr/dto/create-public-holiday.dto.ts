import { IsDateString, IsNotEmpty, IsString } from 'class-validator';

export class CreatePublicHolidayDto {
  @IsDateString()
  date!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;
}
