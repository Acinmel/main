import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

const MSG_LOGIN = '请先登录';
const MSG_INVALID = '无效或过期的登录状态';

/**
 * 校验 Authorization Bearer JWT，返回 `sub`（用户 id）。
 * 非 JWT、过期、缺失均抛出 401。
 */
export function requireJwtUserId(authHeader?: string): string {
  if (!authHeader?.trim()) {
    throw new UnauthorizedException(MSG_LOGIN);
  }
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const token = m?.[1] ?? '';
  if (!token) {
    throw new UnauthorizedException(MSG_LOGIN);
  }
  const secret =
    process.env.JWT_SECRET?.trim() || 'dev-only-jwt-secret-change-in-production';
  try {
    const p = jwt.verify(token, secret) as { sub?: string };
    if (p.sub && typeof p.sub === 'string' && p.sub.length > 0) {
      return p.sub;
    }
  } catch {
    throw new UnauthorizedException(MSG_INVALID);
  }
  throw new UnauthorizedException(MSG_INVALID);
}
