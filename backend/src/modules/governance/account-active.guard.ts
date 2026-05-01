import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';

/**
 * JwtAuthGuard 之后：
 * - 已停用：禁止（与 assertAccountUsable 一致）
 * - 管理员或已开通(active)：全部业务 API
 * - 待审核(pending)：仅 /v1/auth/me；**禁止** tools / tasks / works 等全部业务 API（含专属数字人上传与生成）
 */
@Injectable()
export class AccountActiveGuard implements CanActivate {

  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  private pathName(req: Request): string {
    return (req.originalUrl ?? req.url ?? '').split('?')[0];
  }

  private isAuthMePath(p: string): boolean {
    return /\/v1\/auth\/me$/.test(p);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    if (req.method === 'OPTIONS') {
      return true;
    }

    const uid = req.userId;
    if (!uid) {
      return true;
    }

    const p = this.pathName(req);
    if (this.isAuthMePath(p)) {
      return true;
    }

    const gov = await this.auth.findUserGovById(uid);
    if (!gov) {
      throw new UnauthorizedException('用户不存在');
    }

    if (gov.account_status === 'disabled') {
      await this.auth.assertAccountUsable(uid);
      return true;
    }

    if (gov.role === 'admin' || gov.account_status === 'active') {
      return true;
    }

    if (gov.account_status === 'pending') {
      throw new ForbiddenException(
        '账号待审核开通，通过后方可使用数字人、口播、任务与作品等功能',
      );
    }

    await this.auth.assertAccountUsable(uid);
    return true;
  }
}
