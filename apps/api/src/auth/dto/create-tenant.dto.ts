import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';

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

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  // SSM/MEPCSA business registration number (D-037).
  @IsOptional()
  @IsString()
  registrationNo?: string;

  // Platform console (D-037) — grants a 14-day trial TenantSubscription
  // immediately, matching the owner's reference "Start as Trial" checkbox.
  @IsOptional()
  @IsBoolean()
  startAsTrial?: boolean;
}
