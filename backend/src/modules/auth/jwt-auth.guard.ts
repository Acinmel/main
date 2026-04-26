import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { requireJwtUserId } from '../tasks/tasks.auth';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * 除 @Public() 外，所有接口必须携带有效 JWT（Bearer）。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (req.method === 'OPTIONS') return true;

    const authHeader = req.headers.authorization;
    const userId = requireJwtUserId(authHeader);
    req.userId = userId;
    return true;
  }
}
