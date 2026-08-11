import { IsString, MaxLength, MinLength } from 'class-validator';

// G4.5d3c-3b1 (D-093) — cancelling a line, not deleting it.
// G4.5d3c-3b2 (D-094) — the reason is now MANDATORY (owner: "A reason is
// mandatory" for line cancellation and consultation waiver alike): a charge
// leaves the bill with who, when and why, or it does not leave the bill.
export class CancelInvoiceLineDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  cancelReason!: string;
}
