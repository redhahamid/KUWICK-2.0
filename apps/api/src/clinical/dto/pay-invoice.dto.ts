import { IsIn, IsNotEmpty, IsString } from 'class-validator';

// Cash/Card/QR/Bank Transfer are the patient-facing methods (kuwick.com's
// real option set); PANEL is used internally for the "fully covered, no
// patient copay" settlement path — the panel company is billed separately
// via an external claim submission (future Panel Claims phase), never
// shown as a payment-method choice in the UI.
const PAYMENT_METHODS = ['CASH', 'CARD', 'QR', 'BANK_TRANSFER', 'PANEL'];

export class PayInvoiceDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(PAYMENT_METHODS)
  paymentMethod!: string;
}
