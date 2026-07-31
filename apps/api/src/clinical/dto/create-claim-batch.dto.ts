import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class CreateClaimBatchDto {
  @IsUUID()
  panelClinicId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  invoiceIds!: string[];

  @IsUUID()
  createdByStaffId!: string;
}
