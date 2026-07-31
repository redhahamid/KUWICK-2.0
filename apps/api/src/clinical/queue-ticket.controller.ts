import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { QueueTicketStatus, QueueType } from '@prisma/client';
import { QueueTicketService } from './queue-ticket.service';
import { QueueDisplayConfigService } from './queue-display-config.service';
import { AddToQueueDto } from './dto/add-to-queue.dto';
import { CancelQueueTicketDto } from './dto/cancel-queue-ticket.dto';
import { CallQueueTicketDto } from './dto/call-queue-ticket.dto';
import { UpdateQueueDisplayConfigDto } from './dto/update-queue-display-config.dto';

@Controller('queue-tickets')
export class QueueTicketController {
  constructor(
    private readonly queueTickets: QueueTicketService,
    private readonly displayConfig: QueueDisplayConfigService,
  ) {}

  @Post()
  addToQueue(@Body() dto: AddToQueueDto) {
    return this.queueTickets.addToQueue(dto);
  }

  @Get()
  findAll(
    @Query('clinicId') clinicId?: string,
    @Query('status') status?: QueueTicketStatus,
    @Query('queueType') queueType?: QueueType,
  ) {
    return this.queueTickets.findAll({ clinicId, status, queueType });
  }

  // Static segment before ':id' so "display-config" never matches as an id.
  @Get('display-config')
  getDisplayConfig(@Query('clinicId') clinicId: string) {
    return this.displayConfig.get(clinicId);
  }

  @Put('display-config')
  putDisplayConfig(@Query('clinicId') clinicId: string, @Body() dto: UpdateQueueDisplayConfigDto) {
    return this.displayConfig.upsert(clinicId, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.queueTickets.findById(id);
  }

  @Patch(':id/call')
  call(@Param('id') id: string, @Body() dto: CallQueueTicketDto) {
    return this.queueTickets.call(id, dto.roomId);
  }

  @Patch(':id/arrived')
  arrived(@Param('id') id: string) {
    return this.queueTickets.arrived(id);
  }

  @Patch(':id/move-to-dispensary')
  moveToDispensary(@Param('id') id: string) {
    return this.queueTickets.moveToDispensary(id);
  }

  @Patch(':id/complete')
  complete(@Param('id') id: string) {
    return this.queueTickets.complete(id);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelQueueTicketDto) {
    return this.queueTickets.cancel(id, dto);
  }
}
