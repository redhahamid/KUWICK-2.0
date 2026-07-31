import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { PlatformLoginDto } from './dto/platform-login.dto';

// Excluded from TenantContextMiddleware (AppModule) — these are the routes
// that must work with no Authorization header at all (you can't be
// required to already have a token to obtain one).
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto);
  }

  @Post('platform/login')
  loginPlatformAdmin(@Body() dto: PlatformLoginDto) {
    return this.auth.loginPlatformAdmin(dto);
  }
}
