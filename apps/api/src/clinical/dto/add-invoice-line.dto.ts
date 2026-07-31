import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min } from 'class-validator';

export class AddInvoiceLineDto {
  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsNumber()
  @IsPositive()
  unitPrice!: number;

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
