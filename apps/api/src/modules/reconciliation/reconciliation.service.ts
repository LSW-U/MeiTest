/**
 * ReconciliationService（批C 对账分流，微信支付预留 2026-09-08，方案V2 §3.3）
 *
 * 读侧三端点（admin 三区展示数据源）：
 *   - listLedgers：台账列表（method/status/orderNo/日期区间筛选，offset 分页，ImportLog 模式）
 *   - getSummary：分区汇总（group by method + cashResult；COD 现金 / 银行转账 / 线上预留三区）
 *   - listBatches：对账单导入批次列表（预留入口，本轮不做真实导入，D7）
 *
 * 写侧不在此处：台账写入走 shared/db/reconciliation-ledger.ts 的
 * writeReconciliationLedgerTx（dispatch deliverTask / admin-payment confirm-receipt 事务内调用）。
 */
import { Injectable } from '@nestjs/common';
import { db } from '../../shared/db';
import type { LedgerPaymentMethod } from '../../shared/db/reconciliation-ledger';

/** 台账状态机字面量（对齐 schema ReconciliationStatus 枚举） */
export type LedgerStatusValue = 'PENDING' | 'MATCHED' | 'DIFF' | 'SETTLED';

export interface ListLedgersFilter {
  method?: LedgerPaymentMethod;
  status?: LedgerStatusValue;
  /** 订单号模糊匹配（contains） */
  orderNo?: string;
  /** ISO 日期区间（含 from 不含 to，落 createdAt） */
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface ListBatchesFilter {
  format?: 'WECHAT' | 'ALIPAY' | 'BANK';
  page?: number;
  pageSize?: number;
}

@Injectable()
export class ReconciliationService {
  /** 台账列表（createdAt 倒序 + offset 分页，对齐 ImportLogService 惯例） */
  async listLedgers(filter: ListLedgersFilter) {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    const where = {
      ...(filter.method ? { paymentMethod: filter.method } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.orderNo
        ? { orderNo: { contains: filter.orderNo, mode: 'insensitive' as const } }
        : {}),
      ...(filter.dateFrom || filter.dateTo
        ? {
            createdAt: {
              ...(filter.dateFrom ? { gte: new Date(filter.dateFrom) } : {}),
              ...(filter.dateTo ? { lt: new Date(filter.dateTo) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.reconciliationLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.reconciliationLedger.count({ where }),
    ]);
    const items = rows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      orderNo: r.orderNo,
      method: r.paymentMethod,
      amountUsd: r.amountUsd,
      exchangeRate: r.exchangeRate,
      amountCny: r.amountCny,
      cashResult: (r.cashResult as 'PAID' | 'SHORT' | 'UNPAID' | null) ?? null,
      status: r.status,
      statementBatchId: r.statementBatchId,
      createdAt: r.createdAt.toISOString(),
    }));
    return { items, page, pageSize, total };
  }

  /**
   * 分区汇总（group by method + cashResult）
   *
   * admin 三区映射：COD 区 = method=COD 各行（cashResult 拆 PAID/SHORT/UNPAID）；
   * 银行转账区 = method=BANK_TRANSFER；线上区 = 其余 method 各行（本轮无数据，预留展示）。
   * totalAmountCny 全 null 组收敛为 0（COD/BANK_TRANSFER 均纯 USD 资金流）。
   */
  async getSummary() {
    const rows = await db.reconciliationLedger.groupBy({
      by: ['paymentMethod', 'cashResult'],
      _count: { _all: true },
      _sum: { amountUsd: true, amountCny: true },
    });
    return {
      items: rows.map((r) => ({
        method: r.paymentMethod,
        cashResult: (r.cashResult as 'PAID' | 'SHORT' | 'UNPAID' | null) ?? null,
        count: r._count._all,
        totalAmountUsd: r._sum.amountUsd ?? 0,
        totalAmountCny: r._sum.amountCny ?? 0,
      })),
    };
  }

  /** 导入批次列表（预留入口，createdAt 倒序） */
  async listBatches(filter: ListBatchesFilter) {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    const where = {
      ...(filter.format ? { format: filter.format } : {}),
    };
    const [rows, total] = await Promise.all([
      db.statementImportBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.statementImportBatch.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        fileName: r.fileName,
        format: r.format,
        rowCount: r.rowCount,
        successCount: r.successCount,
        failedCount: r.failedCount,
        status: r.status,
        operatorId: r.operatorId,
        createdAt: r.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }
}
