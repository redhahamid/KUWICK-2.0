import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { OrderUrgency } from '@prisma/client';

export class CreateOrderServiceDto {
  @IsString()
  visitId!: string;

  @IsString()
  serviceCatalogId!: string;

  @IsOptional()
  @IsString()
  instruction?: string;

  // ---- b2 PHASE E ---------------------------------------------------------
  //
  // All optional, and that is not laziness. The two order types ask for
  // different things — a task order needs a room and an urgency, a standard
  // service needs a quantity — and the service enforces which fields make
  // sense for which type rather than the DTO pretending one shape fits both.

  /** Where a TASK ORDER is carried out. Validated against this clinic's rooms. */
  @IsOptional()
  @IsUUID()
  roomId?: string;

  @IsOptional()
  @IsEnum(OrderUrgency)
  urgency?: OrderUrgency;

  /**
   * How many were delivered. Capped rather than trusted: the invoice
   * multiplies the catalogue price by this, so an unbounded number here is an
   * unbounded charge, and nothing in a clinic is delivered 10,000 times in one
   * visit.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  quantity?: number;
}
