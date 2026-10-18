/**
 * Engagement Module — 批4 触达自动化（2026-10-18）
 *
 * 提供：
 *   - EngagementService：六流实现（C1/C2/C3/C6 + B2/B3），幂等 + E3 频控出闸统一
 *   - EngagementProcessor + Scheduler：BullMQ 每 30min 定时扫描
 *   - ClientSubscriptionController：B2 补货提醒手工订阅端点（/client/subscriptions）
 *
 * 依赖：
 *   - NotificationModule（NotificationEventServiceToken：模板渲染 + 站内信 + PUSH）
 *   - SegmentModule（SegmentServiceToken：C1 定向券复用批2 grant 事务）
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EngagementService } from './engagement.service';
import { EngagementProcessor } from './engagement.processor';
import { EngagementScheduler } from './engagement.scheduler';
import { ClientSubscriptionController } from './client-subscription.controller';
import { NotificationModule } from '../notification/notification.module';
import { SegmentModule } from '../segment/segment.module';
import { ENGAGEMENT_QUEUE } from '../../shared/queue';

@Module({
  imports: [
    NotificationModule,
    SegmentModule,
    BullModule.registerQueue({
      name: ENGAGEMENT_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    }),
  ],
  controllers: [ClientSubscriptionController],
  providers: [
    EngagementService,
    EngagementProcessor,
    EngagementScheduler,
    // 显式 DI token（tsx 不 emit 装饰器元数据——本仓红线）
    { provide: 'EngagementServiceToken', useExisting: EngagementService },
  ],
  exports: [EngagementService],
})
export class EngagementModule {}
