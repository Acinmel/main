import { Body, Controller, Get, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() body: { email?: string; password?: string }) {
    return this.auth.register(body.email ?? '', body.password ?? '');
  }

  @Public()
  @Post('login')
  async login(@Body() body: { email?: string; password?: string }) {
    return this.auth.login(body.email ?? '', body.password ?? '');
  }

  /** 当前登录用户资料（需有效 JWT） */
  @Get('me')
  async me(@Req() req: Request) {
    const userId = req.userId!;
    const row = await this.auth.findUserById(userId);
    if (!row) {
      throw new UnauthorizedException('用户不存在或已失效');
    }
    return { user: { id: row.id, email: row.email } };
  }
}
