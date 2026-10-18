/**
 * Admin Collaborative Controller — 批6 P3-2 手动触发入口（2026-10-18）
 *
 * POST /api/v1/admin/marketing/collaborative/recompute — 投递协同过滤全量重算 job
 * （首版数据立即可出：表为空 → A9 恒空、B7 信号恒 0，无需等 cron 点）。
 * 门控 @Roles('SUPER_ADMIN')；POST 默认走审计 interceptor，@Audit 显式声明 resource。
 */
import { Controller, Post } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { COLLABORATIVE_QUEUE } from '../../shared/queue';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import { COLLABORATIVE_JOB_RECOMPUTE } from './collaborative.processor';

@Controller('api/v1/admin/marketing/collaborative')
@Roles('SUPER_ADMIN')
export class AdminCollaborativeController {
  constructor(
    @InjectQueue(COLLABORATIVE_QUEUE)
    private readonly queue: Queue<Record<string, never>, { users: number; picks: number; elapsedMs: number }>,
  ) {}

  /** POST /admin/marketing/collaborative/recompute - 手动触发全量重算（异步 job） */
  @Post('recompute')
  @Audit({ resource: 'CollaborativeRecompute' })
  async recompute() {
    const job = await this.queue.add(COLLABORATIVE_JOB_RECOMPUTE, {} as Record<string, never>);
    return { success: true as const, data: { jobId: job.id } };
  }
}
