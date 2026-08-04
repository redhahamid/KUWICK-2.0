import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { QueueTicketStatus, QueueType } from '@prisma/client';
import { QueueTicketService } from './queue-ticket.service';
import { QueueDisplayConfigService } from './queue-display-config.service';
import { QueueBoardService } from './queue-board.service';
import { AddToQueueDto } from './dto/add-to-queue.dto';
import { CancelQueueTicketDto } from './dto/cancel-queue-ticket.dto';
import { CallQueueTicketDto } from './dto/call-queue-ticket.dto';
import { ChangeAttendingClinicianDto } from './dto/change-attending-clinician.dto';
import { UpdateQueueDisplayConfigDto } from './dto/update-queue-display-config.dto';

@Controller('queue-tickets')
export class QueueTicketController {
  constructor(
    private readonly queueTickets: QueueTicketService,
    private readonly displayConfig: QueueDisplayConfigService,
    private readonly queueBoard: QueueBoardService,
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

  // G4.5d3c-3b (D-095) - the six-stage queue board: every active ticket with
  // its stage, dispensing progress, billing state, outstanding blockers and
  // the SERVER'S completion decision. Static segment before ':id'.
  @Get('board')
  board(@Query('clinicId') clinicId: string) {
    return this.queueBoard.board(clinicId);
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
    return this.queueTickets.call(id, dto.roomId, dto.staffId);
  }

  // S3b (D-081) — assign or transfer the attending clinician. Its own route
  // rather than a corner of `call`, because it is its own clinical act: it
  // carries a reason, it writes a handover event, and it is the one queue
  // operation whose permission depends on who currently holds the visit.
  @Patch(':id/attending-clinician')
  changeAttendingClinician(@Param('id') id: string, @Body() dto: ChangeAttendingClinicianDto) {
    return this.queueTickets.changeAttendingClinician(id, dto);
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
