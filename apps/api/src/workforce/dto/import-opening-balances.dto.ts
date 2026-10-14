import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';
import { LEAVE_CODE } from '../../hr/leave-types';

class OpeningBalanceRow {
  @IsString() employeeNo!: string;
  @Matches(LEAVE_CODE, { message: 'Leave type is a code, e.g. ANNUAL.' }) leaveType!: string;
  @IsNumber() @Min(0) @Max(365) takenDays!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(365) carriedInDays?: number;
}

/** Leave taken before go-live and days carried in (Section D), one row per person and type. */
export class ImportOpeningBalancesDto {
  @IsInt() @Min(2000) @Max(2100) year!: number;
  @ValidateNested({ each: true })
  @Type(() => OpeningBalanceRow)
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  rows!: OpeningBalanceRow[];
}
