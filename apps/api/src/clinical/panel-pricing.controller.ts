import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { PanelPricingService } from './panel-pricing.service';
import { CreatePanelPriceOverrideDto } from './dto/create-panel-price-override.dto';
import { CreatePanelExclusionDto } from './dto/create-panel-exclusion.dto';

@Controller('panel-clinics/:panelId')
export class PanelPricingController {
  constructor(private readonly pricing: PanelPricingService) {}

  @Get('price-overrides')
  findOverrides(@Param('panelId') panelId: string) {
    return this.pricing.findOverrides(panelId);
  }

  @Post('price-overrides')
  createOverride(@Param('panelId') panelId: string, @Body() dto: CreatePanelPriceOverrideDto) {
    return this.pricing.createOverride(panelId, dto);
  }

  @Delete('price-overrides/:id')
  @HttpCode(204)
  removeOverride(@Param('panelId') panelId: string, @Param('id') id: string) {
    return this.pricing.removeOverride(panelId, id);
  }

  @Get('exclusions')
  findExclusions(@Param('panelId') panelId: string) {
    return this.pricing.findExclusions(panelId);
  }

  @Post('exclusions')
  createExclusion(@Param('panelId') panelId: string, @Body() dto: CreatePanelExclusionDto) {
    return this.pricing.createExclusion(panelId, dto);
  }

  @Delete('exclusions/:id')
  @HttpCode(204)
  removeExclusion(@Param('panelId') panelId: string, @Param('id') id: string) {
    return this.pricing.removeExclusion(panelId, id);
  }
}
