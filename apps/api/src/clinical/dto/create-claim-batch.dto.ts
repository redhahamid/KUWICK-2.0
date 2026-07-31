import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class CreateClaimBatchDto {
  @IsUUID()
  panelClinicId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  invoiceIds!: string[];

  @IsUUID()
  createdByStaffId!: string;

  // D-041 — the panel's add-on fee % applied per line ("claim RM100 →
  // claimed RM108" = 8). Optional; 0 when omitted.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  feePercent?: number;
}

