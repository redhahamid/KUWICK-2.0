import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { GlobalSettingService } from './global-setting.service';
import { SetGlobalSettingDto } from './dto/set-global-setting.dto';

@Controller('global-settings')
export class GlobalSettingController {
  constructor(private readonly settings: GlobalSettingService) {}

  @Get(':key')
  get(@Param('key') key: string) {
    return this.settings.get(key);
  }

  @Put(':key')
  set(@Param('key') key: string, @Body() dto: SetGlobalSettingDto) {
    return this.settings.set(key, dto.value);
  }
}
