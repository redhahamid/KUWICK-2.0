import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { BUILD_SHA } from './build-info';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    // The deployed commit, so "which build is this?" is a curl, not a
    // guessing game across the owner, the repo and the Railway dashboard.
    return { status: 'ok', database: 'connected', build: BUILD_SHA };
  }
}
