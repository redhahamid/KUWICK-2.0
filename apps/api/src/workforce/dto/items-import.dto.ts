import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/**
 * One CSV row, as text: the service reads and checks every cell so the
 * preview can say what is wrong with each, rather than the request being
 * refused whole for one bad amount.
 */
export class ItemsImportRowDto {
  @IsOptional() @IsString() @MaxLength(64) employeeNo?: string;
  @IsOptional() @IsString() @MaxLength(64) itemCode?: string;
  @IsOptional() @IsString() @MaxLength(32) amount?: string;
  @IsOptional() @IsString() @MaxLength(16) earnedIn?: string;
  @IsOptional() @IsString() @MaxLength(16) pcbType?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ItemsImportDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ItemsImportRowDto)
  rows!: ItemsImportRowDto[];

  /** For the record of who imported what. */
  @IsOptional() @IsString() @MaxLength(200) fileName?: string;

  /** Absent or false: check every row and save nothing. True: save, only if every row passes. */
  @IsOptional() @IsBoolean() commit?: boolean;
}
