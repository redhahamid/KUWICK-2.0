import { IsOptional, IsString } from 'class-validator';

export class CompleteOrderServiceDto {
  @IsOptional()
  @IsString()
  result?: string;
}
