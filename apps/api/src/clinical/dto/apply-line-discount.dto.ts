import { IsEnum, IsNumber, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
import { InvoiceDiscountType } from '@prisma/client';

// G4.5d3c-3b1 (D-093) — a discount always carries its reason. One with no
// reason is indistinguishable from a mistake, and this row is the audit.
export class ApplyLineDiscountDto {
  @IsEnum(InvoiceDiscountType)
  type!: InvoiceDiscountType;

  @IsNumber()
  @IsPositive()
  value!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}
