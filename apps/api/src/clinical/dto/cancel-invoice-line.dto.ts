import { IsOptional, IsString, MaxLength } from 'class-validator';

// G4.5d3c-3b1 (D-093) — cancelling a line, not deleting it. The reason is
// stored with the actor and timestamp; optional because the legacy DELETE
// call sends no body, but always recorded when given.
export class CancelInvoiceLineDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  cancelReason?: string;
}
