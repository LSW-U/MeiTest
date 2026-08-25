/**
 * About Controller — 关于页可配置数据下发（P25 #2，2026-08-25）
 *
 * 路径：
 *   GET  /api/v1/client/about/profile   公开（关于页读，无需登录）
 *
 * 决策依据：
 *   - P25 §2.2：HTML 原型 D13 预留端点，前端先 fallback 静态值，接口排期后接真实数据
 *   - @Public：关于页在登录前后都可能进（与 home-entries 同模式）
 *   - client 前缀 → DeviceTypeGuard 限制 deviceType=client_app，但 @Public 时无 user 自动跳过
 *   - stats 用 Prisma count，socials 从 SystemConfig 读，Redis 缓存 1h
 *
 * 错误码：socials 未 seed / 配置损坏 → E-ABOUT-001
 */
import { Controller, Get, Inject } from '@nestjs/common';
import { AboutService } from './about.service';
import { Public } from '../../shared/decorators/public.decorator';

@Controller('api/v1/client/about')
export class AboutController {
  constructor(@Inject(AboutService) private readonly about: AboutService) {}

  /** 公开获取关于页可配置数据（stats 信任数据条 + socials 社交链接） */
  @Public()
  @Get('profile')
  async getProfile() {
    const data = await this.about.getProfile();
    return { success: true, data };
  }
}
