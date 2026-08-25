/**
 * About Module — 关于页可配置数据（P25 #2，2026-08-25）
 *
 * 提供：
 *   - AboutService（stats Prisma count + socials SystemConfig 读 + Redis 缓存 1h）
 *   - AboutController（C 端 1 端点，前缀 /api/v1/client/about，@Public）
 *
 * 依赖：
 *   - Prisma 全局 db 单例（shared/db，不注入）
 *   - Redis 全局单例（shared/cache，不注入）
 *
 * 不依赖 SystemConfigService（直接读 db.systemConfig，因为 socials 是只读消费，
 * 不需要 SystemConfigService 的 Redis cache-aside 层——about 已有自身缓存层）。
 */
import { Module } from '@nestjs/common';
import { AboutController } from './about.controller';
import { AboutService } from './about.service';

@Module({
  controllers: [AboutController],
  providers: [AboutService],
  exports: [AboutService],
})
export class AboutModule {}
