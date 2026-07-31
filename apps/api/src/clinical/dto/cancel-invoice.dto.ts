import { IsOptional, IsString } from 'class-validator';

export class CancelInvoiceDto {
  @IsOptional()
  @IsString()
  cancelReason?: string;
}
