import { IsInt, IsNumber, IsPositive, IsString, Min, MinLength } from 'class-validator';

export class CreateItemAgeDosageDto {
  @IsString()
  itemId!: string;

  @IsInt()
  @Min(0)
  ageFromMonths!: number;

  @IsInt()
  @Min(0)
  ageToMonths!: number;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @MinLength(1)
  unit!: string;

  @IsString()
  @MinLength(1)
  frequency!: string;
}
