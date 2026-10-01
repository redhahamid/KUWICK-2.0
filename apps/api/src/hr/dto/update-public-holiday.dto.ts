import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** A holiday's name or kind, after the fact; the date is the row's identity and is not moved. */
export class UpdatePublicHolidayDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsIn(['ORDINARY', 'FESTIVE']) kind?: 'ORDINARY' | 'FESTIVE';
}
