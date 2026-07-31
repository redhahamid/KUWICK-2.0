import { IsNotEmpty, IsString } from 'class-validator';

export class PlatformLoginDto {
  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
