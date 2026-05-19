import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { HealthService } from './health.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  getHealth() {
    return this.health.basic();
  }

  @Get('deep')
  getDeepHealth(@Req() req: Request) {
    const detailed = this.health.allowDetailedHealth(req);
    return this.health.deep({ detailed });
  }
}
