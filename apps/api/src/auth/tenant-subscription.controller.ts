import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PlatformAuthGuard } from './platform-auth.guard';
import { TenantSubscriptionService } from './tenant-subscription.service';
import { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import { ExtendSubscriptionDto } from './dto/extend-subscription.dto';

@Controller('platform/subscriptions')
@UseGuards(PlatformAuthGuard)
export class TenantSubscriptionController {
  constructor(private readonly subscriptions: TenantSubscriptionService) {}

  @Get()
  findAll() {
    return this.subscriptions.findAll();
  }

  @Post()
  activate(@Body() dto: ActivateSubscriptionDto) {
    return this.subscriptions.activate(dto);
  }

  @Patch(':id/extend')
  extend(@Param('id') id: string, @Body() dto: ExtendSubscriptionDto) {
    return this.subscriptions.extend(id, dto);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.subscriptions.cancel(id);
  }
}
