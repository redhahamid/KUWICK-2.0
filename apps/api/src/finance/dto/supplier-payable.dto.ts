import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SupplierInvoiceStatus } from '@prisma/client';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

/** What a supplier has billed the clinic. */
export class RecordSupplierInvoiceDto {
  @IsUUID()
  supplierId!: string;

  /** The supplier's own number, as printed. Unique per supplier, not globally. */
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  invoiceNumber!: string;

  @IsISO8601()
  invoiceDate!: string;

  /**
   * Optional. Left out, the service derives it from the supplier's configured
   * payment term — and leaves it NULL if there is no term, rather than
   * assuming thirty days.
   */
  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @Matches(MONEY)
  totalAmount!: string;

  @IsOptional()
  @Matches(MONEY)
  taxAmount?: string;

  /** The delivery this invoice is for. The link the spreadsheet cannot have. */
  @IsOptional()
  @IsUUID()
  goodsReceivedNoteId?: string;

  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;

  @IsOptional()
  @Matches(/^https?:\/\/.+/, { message: 'A document link must start with http:// or https://' })
  @MaxLength(500)
  documentUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateSupplierInvoiceDto {
  @IsOptional()
  @IsEnum(SupplierInvoiceStatus)
  status?: SupplierInvoiceStatus;

  /** Required by the service whenever the status becomes DISPUTED. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  disputeReason?: string;

  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @IsOptional()
  @IsUUID()
  goodsReceivedNoteId?: string;

  @IsOptional()
  @Matches(/^https?:\/\/.+/)
  @MaxLength(500)
  documentUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class SupplierPaymentAllocationDto {
  @IsUUID()
  supplierInvoiceId!: string;

  @Matches(MONEY)
  amount!: string;
}

/**
 * MONEY LEAVING THE CLINIC.
 *
 * Allocations are mandatory and must equal the payment exactly — the same rule
 * as a panel remittance, and for the same reason: a payment that does not say
 * which invoices it settled leaves every balance a guess.
 */
export class RecordSupplierPaymentDto {
  @IsUUID()
  supplierId!: string;

  @IsISO8601()
  paidAt!: string;

  @Matches(MONEY)
  amount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ValidateNested({ each: true })
  @Type(() => SupplierPaymentAllocationDto)
  allocations!: SupplierPaymentAllocationDto[];
}

/** The commercial terms the clinic keeps in spreadsheet prose. */
export class UpdateSupplierTermsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermDays?: number;

  @IsOptional()
  @Matches(MONEY)
  creditLimitAmount?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  deliverySlaDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
