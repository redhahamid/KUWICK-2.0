import { IsInt, IsUUID, Min } from 'class-validator';

export class CreateProcurementRequestDto {
  @IsUUID()
  clinicId!: string;

  @IsUUID()
  itemId!: string;

  @IsInt()
  @Min(1)
  requestedQuantity!: number;
}
