/**
 * Settle Module — 流程 M W3（结算单 + 提现申请）
 *
 * 决策依据：
 * - W-M-C-T 流程 3 W3 M2 settle（结算单生成 + 提现审核）
 * - 决策 2026-06-24：T+1 频率，接口预留配置项；mock 订单骨架，C 流程完成后切真
 *
 * 切真 OrderAggregator：
 *   settle.module.ts providers 改 SETTLE_ORDER_AGGREGATOR 的 useClass
 *   从 MockOrderAggregator 改成 RealOrderAggregator（C 流程提供）
 */
import { Module } from '@nestjs/common';
import { SettlementController } from './settlement.controller';
import { WithdrawalController } from './withdraw.controller';
import { SettlementService, MockOrderAggregator, SETTLE_ORDER_AGGREGATOR } from './settlement.service';
import { WithdrawalService } from './withdraw.service';

@Module({
  controllers: [SettlementController, WithdrawalController],
  providers: [
    SettlementService,
    WithdrawalService,
    // MVP 阶段 mock 订单聚合；C 流程订单完成后改 useClass: RealOrderAggregator
    { provide: SETTLE_ORDER_AGGREGATOR, useClass: MockOrderAggregator },
  ],
  exports: [SettlementService, WithdrawalService],
})
export class SettleModule {}
