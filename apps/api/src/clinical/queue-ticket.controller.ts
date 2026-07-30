import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { QueueTicketStatus } from '@prisma/client';
import { QueueTicketService } from './queue-ticket.service';
import { AddToQueueDto } from './dto/add-to-queue.dto';
import { CancelQueueTicketDto } from './dto/cancel-queue-ticket.dto';

@Controller('queue-tickets')
export class QueueTicketController {
  constructor(private readonly queueTickets: QueueTicketService) {}

  @Post()
  addToQueue(@Body() dto: AddToQueueDto) {
    return this.queueTickets.addToQueue(dto);
  }

  @Get()
  findAll(@Query('clinicId') clinicId?: string, @Query('status') status?: QueueTicketStatus) {
    return this.queueTickets.findAll({ clinicId, status });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.queueTickets.findById(id);
  }

  @Patch(':id/call')
  call(@Param('id') id: string) {
    return this.queueTickets.call(id);
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
