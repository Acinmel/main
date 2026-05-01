import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';

/** 需在 JwtAuthGuard 之后；仅 role=admin 可访问 */
@Injectable()
export class AdminRoleGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const uid = req.userId;
    if (!uid) {
      throw new ForbiddenException('请先登录');
    }
    const ok = await this.auth.isAdmin(uid);
    if (!ok) {
      throw new ForbiddenException('需要管理员权限');
    }
    return true;
  }
}
