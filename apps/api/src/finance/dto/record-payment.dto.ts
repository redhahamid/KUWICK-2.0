import { IsBoolean, IsEnum, IsISO8601, IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { PaymentKind, PaymentTender } from '@prisma/client';

/**
 * Money as a STRING, deliberately.
 *
 * `120.35` arriving as a JSON number is a float before any code here sees it,
 * and `class-validator`'s `@IsNumber` would happily accept 120.34999999999999.
 * A regex-validated decimal string reaches `toCents` exactly as the counter
 * typed it.
 */
const MONEY = /^\d{1,8}(\.\d{1,2})?$/;

export class RecordPaymentDto {
  @Matches(MONEY, { message: 'amount must be a positive value with at most two decimal places' })
  amount!: string;

  @IsOptional()
  @IsEnum(PaymentKind)
  kind?: PaymentKind;

  @IsOptional()
  @IsEnum(PaymentTender)
  tender?: PaymentTender;

  /** What the counter actually chose. Mapped to a canonical tender if `tender` is absent. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  methodLabel?: string;

  /** When the money moved, if not now. Back-dating into a CLOSED day is refused. */
  @IsOptional()
  @IsISO8601()
  receivedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  referenceNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /**
   * Explicit confirmation that collecting more than the outstanding balance is
   * intended. Without it an over-collection is refused rather than silently
   * creating a credit nobody meant to give.
   */
  @IsOptional()
  @IsBoolean()
  allowOverpayment?: boolean;
}
