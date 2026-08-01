import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  // D-049 — optional: login is email-only by default. Only needed (and only
  // asked for by the frontend) when the same email+password validates at
  // more than one clinic, which the backend signals explicitly.
  @IsOptional()
  @IsString()
  slug?: string;

  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
