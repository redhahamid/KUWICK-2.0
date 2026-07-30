import { IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateServiceDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsInt()
  @Min(1)
  durationMinutesDefault!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;
}
