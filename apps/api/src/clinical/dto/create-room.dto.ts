import { IsBoolean, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateRoomDto {
  @IsUUID()
  clinicId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
