import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const MONEY = /^\d{1,8}(\.\d{1,2})?$/;

export class CreditNoteLineDto {
  /** NULL for a whole-invoice credit (goodwill, a write-down) — a real case. */
  @IsOptional()
  @IsUUID()
  invoiceLineId?: string;

  @IsString()
  @MaxLength(300)
  description!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @Matches(MONEY)
  amount!: string;

  @IsOptional()
  @Matches(MONEY)
  taxAmount?: string;
}

export class CreateCreditNoteDto {
  @IsUUID()
  invoiceId!: string;

  @IsString()
  @MinLength(5, { message: 'Say why this invoice is being credited.' })
  @MaxLength(500)
  reason!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreditNoteLineDto)
  lines!: CreditNoteLineDto[];
}
