import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ItemService } from './item.service';
import { ItemPanelPricingService } from './item-panel-pricing.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';

@Controller('items')
export class ItemController {
  constructor(
    private readonly itemService: ItemService,
    private readonly panelPricing: ItemPanelPricingService,
  ) {}

  @Post()
  create(@Body() dto: CreateItemDto) {
    return this.itemService.create(dto);
  }

  @Get()
  findAll(
    @Query('activeOnly') activeOnly?: string,
    @Query('search') search?: string,
    @Query('take') take?: string,
  ) {
    const parsed = take ? Number(take) : undefined;
    return this.itemService.findAll(
      activeOnly === 'true',
      search,
      Number.isFinite(parsed) ? parsed : undefined,
    );
  }

  /**
   * DECLARED BEFORE `:id`, and it has to be: Nest matches routes in the order
   * they are declared, so `/items/catalogue` would otherwise arrive at
   * `findOne('catalogue')` and 404 on an item id nobody asked for.
   */
  @Get('catalogue')
  catalogue(
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('attentionOnly') attentionOnly?: string,
    @Query('activeOnly') activeOnly?: string,
    @Query('clinicId') clinicId?: string,
  ) {
    return this.itemService.catalogue({
      search,
      category,
      attentionOnly: attentionOnly === 'true',
      activeOnly: activeOnly === 'true',
      clinicId,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.itemService.findById(id);
  }

  /**
   * Panel pricing, seen from the item. The same `PanelPriceOverride` table the
   * Panel detail screen writes — read the other way round, because "what does
   * each panel pay for THIS medicine" cannot be answered from a panel-keyed
   * screen without opening every panel in turn.
   */
  @Get(':id/panel-pricing')
  panelPricingFor(@Param('id') id: string) {
    return this.panelPricing.listForItem(id);
  }

  @Put(':id/panel-pricing/:panelClinicId')
  setPanelPricing(
    @Param('id') id: string,
    @Param('panelClinicId') panelClinicId: string,
    @Body() body: { overridePrice?: number | null },
  ) {
    return this.panelPricing.setForItem(id, panelClinicId, body?.overridePrice ?? null);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.itemService.update(id, dto);
  }
}
