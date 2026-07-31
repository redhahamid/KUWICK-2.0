import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @MinLength(1)
  name!: string;

  // Lowercase letters, numbers, hyphens only — this is typed by a real
  // person at login time, so it stays simple and unambiguous.
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug may only contain lowercase letters, numbers, and hyphens' })
  slug!: string;
}
