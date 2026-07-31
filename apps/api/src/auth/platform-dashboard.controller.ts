import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformDashboardService } from './platform-dashboard.service';
import { PlatformSettingService } from './platform-setting.service';

@Controller('platform')
@UseGuards(PlatformAuthGuard)
export class PlatformDashboardController {
  constructor(
    private readonly dashboard: PlatformDashboardService,
    private readonly settings: PlatformSettingService,
  ) {}

  @Get('dashboard')
  getDashboard() {
    return this.dashboard.getSummary();
  }

  @Get('settings')
  getSettings() {
    return this.settings.getAll();
  }

  @Put('settings')
  putSettings(@Body() body: Record<string, unknown>) {
    return this.settings.setMany(body);
  }
}
