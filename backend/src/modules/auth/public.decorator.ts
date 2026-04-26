import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** 跳过全局 JWT 守卫（仅注册、登录等） */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
