import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    /** JwtAuthGuard 在校验 JWT 后写入 */
    userId?: string;
  }
}
