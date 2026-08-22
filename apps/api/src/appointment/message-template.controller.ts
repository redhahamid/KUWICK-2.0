import { BadRequestException, Body, Controller, Get, Put, Query } from '@nestjs/common';
import { MessageTemplateService } from './message-template.service';
import { UpsertMessageTemplateDto } from './dto/message-template.dto';

@Controller('appointment-message-templates')
export class MessageTemplateController {
  constructor(private readonly templates: MessageTemplateService) {}

  @Get()
  list(@Query('clinicId') clinicId: string) {
    if (!clinicId) throw new BadRequestException('clinicId is required');
    return this.templates.list(clinicId);
  }

  @Put()
  upsert(@Body() dto: UpsertMessageTemplateDto) {
    return this.templates.upsert(dto);
  }
}
