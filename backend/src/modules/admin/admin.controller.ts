import {
  Controller,
  Get,
  Patch,
  Body,
  Query,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminRoleGuard } from '../governance/admin-role.guard';
import { AdminService } from './admin.service';

class PatchUserDto {
  role?: 'user' | 'admin';
  accountStatus?: 'pending' | 'active' | 'disabled';
}

@Controller('v1/admin')
@UseGuards(AdminRoleGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats() {
    return this.admin.globalStats();
  }

  @Get('users')
  listUsers(
    @Query('q') q?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;
    return this.admin.listUsers({ q, limit, offset });
  }

  @Patch('users/:id')
  patchUser(@Param('id') id: string, @Body() body: PatchUserDto) {
    return this.admin.updateUser(id, {
      role: body.role,
      accountStatus: body.accountStatus,
    });
  }

  @Get('audit-logs')
  listAuditLogs(
    @Req() _req: Request,
    @Query('q') q?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : 80;
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;
    return this.admin.listAuditLogs({ q, limit, offset });
  }

  @Get('user-works')
  listUserWorks(
    @Query('q') q?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : 30;
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;
    return this.admin.listUserWorks({ q, limit, offset });
  }

  @Get('digital-human-templates')
  listDigitalHumanTemplates(
    @Query('q') q?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : 30;
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;
    return this.admin.listDigitalHumanTemplates({ q, limit, offset });
  }
}
