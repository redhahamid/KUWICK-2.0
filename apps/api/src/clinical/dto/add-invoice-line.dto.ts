import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min } from 'class-validator';

export class AddInvoiceLineDto {
  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  // G4.5d3c-3b1 (D-093) — REQUIRED for a free-text MANUAL line, IGNORED for a
  // sourced line: the server resolves a sourced line's contractual price
  // itself and a browser cannot override it.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  unitPrice?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  // Quick-Add sourcing (Phase A8) — set when this line was added from a
  // completed OrderService/dispensed Prescription rather than typed
  // freehand, so the UI can tell what's already billed and InvoiceService
  // can auto-check panel exclusions.
  @IsOptional()
  @IsUUID()
  sourceOrderServiceId?: string;

  @IsOptional()
  @IsUUID()
  sourcePrescriptionId?: string;
}
