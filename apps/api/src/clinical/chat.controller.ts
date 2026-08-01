import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ChatService } from './chat.service';

@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('clinics/:clinicId/chat-messages')
  listClinic(@Param('clinicId') clinicId: string) {
    return this.chat.listClinicWide(clinicId);
  }

  @Post('clinics/:clinicId/chat-messages')
  createClinic(@Param('clinicId') clinicId: string, @Body('message') message: string) {
    return this.chat.createClinicWide(clinicId, message);
  }

  @Get('order-services/:orderServiceId/chat-messages')
  listOrder(@Param('orderServiceId') orderServiceId: string) {
    return this.chat.listForOrder(orderServiceId);
  }

  @Post('order-services/:orderServiceId/chat-messages')
  createOrder(@Param('orderServiceId') orderServiceId: string, @Body('message') message: string) {
    return this.chat.createForOrder(orderServiceId, message);
  }
}
