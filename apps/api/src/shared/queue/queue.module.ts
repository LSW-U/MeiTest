/**
 * BullMQ 共享基建 Module（流程 C W3 引入）
 *
 * 设计要点：
 *   - BullModule.forRoot：从 REDIS_URL 读取配置，与 shared/cache 共用同一 Redis 实例
 *   - V2-S8 修复：BullMQ 用独立 keyPrefix 'bull:'（避免运维清缓存误删 BullMQ 任务）
 *   - @Global()：让 feature 模块直接 registerQueue 即可，不需 import QueueModule
 *   - 队列注册（registerQueue）由各 feature 模块自己声明（保持模块边界）
 *
 * 决策依据：
 *   - CLAUDE.md §技术栈（Redis 7 + BullMQ）
 *   - W3-C 任务分解：order 超时取消（BullMQ 延迟队列）
 *   - W3-M 也用 BullMQ 做 settle T+1，共享同一 Redis 连接
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
        // V2-S8 修复：独立 keyPrefix，与业务 cache (meimart:) 隔离
        //   - 业务缓存：meimart:cart:* / meimart:rider:online:* / meimart:jwt-blacklist:*
        //   - BullMQ 队列：bull:* （内部 key 格式 bull:<queue>:<id>）
        //   - 运维 redis-cli --scan --pattern 'meimart:*' | xargs del 不会误删队列
        keyPrefix: process.env.BULLMQ_KEY_PREFIX ?? 'bull:',
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
