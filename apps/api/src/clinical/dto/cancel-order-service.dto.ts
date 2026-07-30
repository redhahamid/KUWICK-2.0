import { IsOptional, IsString } from 'class-validator';

export class CancelOrderServiceDto {
  @IsOptional()
  @IsString()
  cancelReason?: string;
}
