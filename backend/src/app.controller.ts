import { Controller, Get } from '@nestjs/common';
import { Public } from './modules/auth/public.decorator';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** 健康检查 / 反代探活（无需 JWT） */
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
