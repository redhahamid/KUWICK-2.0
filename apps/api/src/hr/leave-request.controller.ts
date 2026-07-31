import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { LeaveStatus } from '@prisma/client';
import { LeaveRequestService } from './leave-request.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { DecideLeaveRequestDto } from './dto/decide-leave-request.dto';

@Controller('leave-requests')
export class LeaveRequestController {
  constructor(private readonly leaveRequests: LeaveRequestService) {}

  @Get()
  findAll(@Query('staffId') staffId?: string, @Query('status') status?: LeaveStatus) {
    return this.leaveRequests.findAll(staffId, status);
  }

  @Post()
  create(@Body() dto: CreateLeaveRequestDto) {
    return this.leaveRequests.create(dto);
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string, @Body() dto: DecideLeaveRequestDto) {
    return this.leaveRequests.approve(id, dto);
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body() dto: DecideLeaveRequestDto) {
    return this.leaveRequests.reject(id, dto);
  }
}
