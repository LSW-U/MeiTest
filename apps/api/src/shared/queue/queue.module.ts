/**
 * BullMQ 共享基建 Module（流程 M W3 引入）
 *
 * 设计要点：
 *   - BullModule.forRoot：从 REDIS_URL 读取配置，与 shared/cache 共用同一实例地址
 *   - 队列注册（registerQueue）由各 feature 模块自己声明（保持模块边界）
 *
 * 决策依据：
 *   - CLAUDE.md §技术栈（Redis 7 + BullMQ）
 *   - W2-M-MANIFEST-W3.md §6：W3 接入 BullMQ 定时任务跑 settlementService.runSettlement
 *   - W3-C 也用 BullMQ 做 order 超时取消，共享同一 Redis 连接
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'meimart:',
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
