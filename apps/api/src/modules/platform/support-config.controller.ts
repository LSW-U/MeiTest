/**
 * Support Config Controller — 客服配置公开下发（P5 #1，2026-08-25）
 *
 * 路径：
 *   GET  /api/v1/common/support/config   公开（骑手/客户端 help 页读，无需登录）
 *
 * 决策依据：
 * - P5 §7 P0：help 页客服号码硬编码 `+670 7700 0000`，应改读后端配置（可拨打 tel:）
 * - 复用 SystemConfigService（key-value + Redis cache-aside），不新建表
 * - seed.ts 预置 support.phone / support.hours 两个 key
 * - @Public：未登录可读（help 页在登录前后都可能进）
 * - 放 common 前缀 → DeviceTypeGuard 不限制 deviceType
 *
 * 错误码：key 缺失（未 seed）→ E-PLATFORM-003
 */
import { Controller, Get, Inject, NotFoundException } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { Public } from '../../shared/decorators/public.decorator';

/** 客服配置视图（help 页消费） */
export interface SupportConfigView {
  /** 客服热线电话（E.164-ish，前端 `tel:` 拨号） */
  phone: string;
  /** 客服工作时间（展示用，纯文本） */
  hours: string;
}

@Controller('api/v1/common/support')
export class SupportConfigController {
  constructor(
    @Inject(SystemConfigService) private readonly config: SystemConfigService,
  ) {}

  /** 公开获取客服配置（phone + hours） */
  @Public()
  @Get('config')
  async getConfig(): Promise<{ success: true; data: SupportConfigView }> {
    // P2-5 修复（2026-08-25）：两个 key 互相独立，串行 await 缓存 miss 期间首字节延迟翻倍，改并行
    const [phone, hours] = await Promise.all([
      this.config.get('support.phone'),
      this.config.get('support.hours'),
    ]);
    if (!phone) {
      // key 未 seed（或被 admin 误删）→ 404，前端降级到本地兜底号码
      throw new NotFoundException({
        code: 'E-PLATFORM-003',
        message: 'Support config not initialized (need seed: support.phone)',
      });
    }
    return {
      success: true,
      data: {
        phone,
        hours: hours ?? '',
      },
    };
  }
}
