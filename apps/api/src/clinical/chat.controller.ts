import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatChannelService } from './chat-channel.service';

@Controller()
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly channels: ChatChannelService,
  ) {}

  @Get('clinics/:clinicId/chat-channels')
  listChannels(@Param('clinicId') clinicId: string) {
    return this.channels.listByClinicWithLatestMessage(clinicId);
  }

  @Post('clinics/:clinicId/chat-channels')
  createChannel(@Param('clinicId') clinicId: string, @Body('name') name: string) {
    return this.channels.create(clinicId, name);
  }

  @Get('chat-channels/:channelId/messages')
  listChannelMessages(@Param('channelId') channelId: string) {
    return this.chat.listChannel(channelId);
  }

  @Post('chat-channels/:channelId/messages')
  createChannelMessage(@Param('channelId') channelId: string, @Body('message') message: string) {
    return this.chat.createInChannel(channelId, message);
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
