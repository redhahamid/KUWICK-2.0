import { IsEnum, IsNumber, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
import { InvoiceDiscountType } from '@prisma/client';

// G4.5d3c-3b1 (D-093) — overall invoice discount. Policy v1:
// AFTER_PANEL_SPLIT_PATIENT_ONLY (owner decision) — it reduces the
// patient-responsible portion only.
export class ApplyInvoiceDiscountDto {
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
