/**
 * @Public() 装饰器：标记端点不需要登录（如 /auth/login、/health）
 */
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
