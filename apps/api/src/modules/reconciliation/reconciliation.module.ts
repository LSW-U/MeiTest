/**
 * ReconciliationModule（批C 对账分流，微信支付预留 2026-09-08，方案V2 §3.3）
 *
 * 只读模块：台账列表 / 分区汇总 / 导入批次列表三端点。
 * 写侧在 dispatch（COD）与 payment（BANK_TRANSFER）模块事务内直调
 * shared/db/reconciliation-ledger.ts，不经本模块（免模块间依赖）。
 */
import { Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { AdminReconciliationController } from './reconciliation.controller';

@Module({
  controllers: [AdminReconciliationController],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
