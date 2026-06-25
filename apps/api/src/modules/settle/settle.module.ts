/**
 * Settle Module — 流程 M W3（结算单 + 提现申请 + T+1 BullMQ 定时任务）
 *
 * 决策依据：
 * - W-M-C-T 流程 3 W3 M2 settle（结算单生成 + 提现审核）
 * - 决策 2026-06-24：T+1 频率，接口预留配置项；mock 订单骨架，C 流程完成后切真
 * - W3 增量：接入 BullMQ T+1 定时任务（02:00 Asia/Dili）
 *
 * 切真 OrderAggregator：
 *   把 SETTLE_ORDER_AGGREGATOR 的 useClass 从 MockOrderAggregator 改成 RealOrderAggregator（C 流程提供）
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SettlementController } from './settlement.controller';
import { WithdrawalController } from './withdraw.controller';
import {
  SettlementService,
  MockOrderAggregator,
  SETTLE_ORDER_AGGREGATOR,
} from './settlement.service';
import { WithdrawalService } from './withdraw.service';
import { SettleProcessor } from './settle.processor';
import { SettleScheduler } from './settle.scheduler';
import { SETTLE_QUEUE } from '../../shared/queue';

@Module({
  imports: [
    BullModule.registerQueue({
      name: SETTLE_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    }),
  ],
  controllers: [SettlementController, WithdrawalController],
  providers: [
    SettlementService,
    WithdrawalService,
    // MVP 阶段 mock 订单聚合；C 流程订单完成后改 useClass: RealOrderAggregator
    { provide: SETTLE_ORDER_AGGREGATOR, useClass: MockOrderAggregator },
    SettleProcessor,
    SettleScheduler,
  ],
  exports: [SettlementService, WithdrawalService],
})
export class SettleModule {}
