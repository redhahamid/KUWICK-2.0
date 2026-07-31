import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RoomService } from './room.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

@Controller('rooms')
export class RoomController {
  constructor(private readonly rooms: RoomService) {}

  @Post()
  create(@Body() dto: CreateRoomDto) {
    return this.rooms.create(dto);
  }

  @Get()
  findAll(@Query('clinicId') clinicId?: string, @Query('activeOnly') activeOnly?: string) {
    return this.rooms.findAll(clinicId, activeOnly === 'true');
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRoomDto) {
    return this.rooms.update(id, dto);
  }
}
