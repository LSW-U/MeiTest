/**
 * Engagement Module — 批4 触达自动化（2026-10-18）
 *
 * 提供：
 *   - EngagementService：十流实现（C1/C2/C3/C6/B2/B3 + 批5 C4/C7/C8/B4），幂等 + E3 频控出闸统一
 *   - BehaviorInsightService：批5 洞察消费（D5 漏斗 / A7 搜索明细 / A8 流失分）
 *   - EngagementProcessor + Scheduler：BullMQ 每 30min 定时扫描
 *   - ClientSubscriptionController：B2 订阅端点（批5 扩展 C7/C8 类型）
 *   - BehaviorController：埋点批量接收（OptionalAuth + 异步降级）
 *   - AdminBehaviorController：admin 洞察端点（漏斗/搜索明细）
 *
 * 依赖：
 *   - NotificationModule（NotificationEventServiceToken：模板渲染 + 站内信 + PUSH）
 *   - SegmentModule（SegmentServiceToken：C1 定向券复用批2 grant 事务）
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EngagementService } from './engagement.service';
import { BehaviorInsightService } from './behavior-insight.service';
import { EngagementProcessor } from './engagement.processor';
import { EngagementScheduler } from './engagement.scheduler';
import { ClientSubscriptionController } from './client-subscription.controller';
import { BehaviorController } from './behavior.controller';
import { AdminBehaviorController } from './admin-behavior.controller';
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
  controllers: [ClientSubscriptionController, BehaviorController, AdminBehaviorController],
  providers: [
    EngagementService,
    BehaviorInsightService,
    EngagementProcessor,
    EngagementScheduler,
    // 显式 DI token（tsx 不 emit 装饰器元数据——本仓红线）
    { provide: 'EngagementServiceToken', useExisting: EngagementService },
    { provide: 'BehaviorInsightServiceToken', useExisting: BehaviorInsightService },
  ],
  exports: [EngagementService],
})
export class EngagementModule {}
