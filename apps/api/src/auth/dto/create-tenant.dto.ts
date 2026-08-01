import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @MinLength(1)
  name!: string;

  // D-049 — optional: auto-derived from the clinic name when omitted (the
  // platform console no longer asks for it). Lowercase letters, numbers,
  // hyphens only when provided — it can still be typed by a real person at
  // login in the rare multi-clinic-email disambiguation case.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug may only contain lowercase letters, numbers, and hyphens' })
  slug?: string;

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

  // D-049 — the clinic's first OWNER_ADMIN login, created together with the
  // clinic so there's something to hand the clinic owner on day one (they
  // then create their own staff logins under Management > HR > Staff).
  // Optional at the DTO level for API compatibility; the console form
  // requires them, since a clinic with no login is unreachable except by
  // platform impersonation — which itself needs a staff login to exist.
  @IsOptional()
  @IsString()
  ownerFullName?: string;

  @IsOptional()
  @IsString()
  ownerEmail?: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Owner password must be at least 8 characters' })
  ownerPassword?: string;
}
