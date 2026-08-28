import { IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ReviewStockTakeDto {
  /**
   * Lines the reviewer will not post. An excluded line's variance is left on
   * the record and off the ledger — "I do not trust this count" is a real
   * answer and it should not require deleting the count.
   */
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  excludeLineIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
