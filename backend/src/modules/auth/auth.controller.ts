import { Body, Controller, Get, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Post('register')
  async register(
    @Body() body: { email?: string; password?: string },
    @Req() req: Request,
  ) {
    const out = await this.auth.register(body.email ?? '', body.password ?? '');
    void this.audit.log(
      out.user.id,
      'user_register',
      `registered_email=${out.user.email}`,
      req,
    );
    return out;
  }

  @Public()
  @Post('login')
  async login(
    @Body() body: { email?: string; password?: string },
    @Req() req: Request,
  ) {
    const out = await this.auth.login(body.email ?? '', body.password ?? '');
    void this.audit.log(out.user.id, 'user_login', undefined, req);
    return out;
  }

  /** 当前登录用户资料（需有效 JWT） */
  @Get('me')
  async me(@Req() req: Request) {
    const userId = req.userId!;
    const row = await this.auth.findUserGovById(userId);
    if (!row) {
      throw new UnauthorizedException('用户不存在或已失效');
    }
    return {
      user: {
        id: row.id,
        email: row.email,
        role: row.role,
        accountStatus: row.account_status,
      },
    };
  }
}
