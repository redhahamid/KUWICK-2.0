import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SlotCapacityConfigService } from './slot-capacity-config.service';
import { CreateSlotCapacityConfigDto } from './dto/create-slot-capacity-config.dto';
import { UpdateSlotCapacityConfigDto } from './dto/update-slot-capacity-config.dto';

@Controller('slot-capacity-configs')
export class SlotCapacityConfigController {
  constructor(private readonly slotCapacityConfigs: SlotCapacityConfigService) {}

  @Post()
  create(@Body() dto: CreateSlotCapacityConfigDto) {
    return this.slotCapacityConfigs.create(dto);
  }

  @Get()
  findAll(
    @Query('staffId') staffId?: string,
    @Query('clinicId') clinicId?: string,
    @Query('serviceId') serviceId?: string,
  ) {
    return this.slotCapacityConfigs.findAll({ staffId, clinicId, serviceId });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSlotCapacityConfigDto) {
    return this.slotCapacityConfigs.update(id, dto);
  }
}
