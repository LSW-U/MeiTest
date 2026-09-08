/**
 * 对账台账写入（批C 对账分流，微信支付预留 2026-09-08，方案V2 §3.3）
 *
 * 统一承载两股资金流（同构 incrementSalesCountForOrder 模式：调用方事务内执行的纯函数）：
 *   - COD 现金：dispatch.service deliverTask（送达事务内，R8 精确落点，覆盖 PAID/SHORT/UNPAID）
 *   - BANK_TRANSFER：admin-payment.controller confirm-receipt（审核通过事务内）
 *   - 线上渠道：预留——未来对账单导入 MATCHED 时写（本轮不产生真实数据，D7）
 *
 * 幂等（方案风险 5）：orderId @unique + 先查后写守卫，同单多事件只写一行；
 * 写入失败只 warn 不阻断主流程（与 @Audit/ImportLog 同策略）——送达/审核事务里
 * 台账缺行可由对账批次人工补，主流程不能被对账挂死。
 */
import { logger } from '../logger/logger';
import type { Tx } from './transaction';

/** 台账 paymentMethod（字面量联合，对齐 schema PaymentMethod 枚举 8 值，避免跨模块 import） */
export type LedgerPaymentMethod =
  | 'COD'
  | 'BANK_TRANSFER'
  | 'WECHAT'
  | 'PAYPAL'
  | 'STRIPE'
  | 'WECHAT_GLOBAL'
  | 'ALIPAY_CN'
  | 'LOCAL_PSP';

/** 台账写入入参（COD 拒付时 amountUsd=0；纯 USD 资金流汇率两字段留空） */
export interface WriteReconciliationLedgerInput {
  orderId: string;
  /** 订单号快照（对账单匹配 + 人工排查主键，免 join） */
  orderNo: string;
  paymentMethod: LedgerPaymentMethod;
  /** 实收金额（分，USD） */
  amountUsd: number;
  /** 汇率快照（万分位，同 Order.exchangeRate 口径）；纯 USD 资金流不传 */
  exchangeRate?: number | null;
  /** 人民币金额（分）；纯 USD 资金流不传 */
  amountCny?: number | null;
  /** COD 收款结果；线上/银行渠道不传 */
  cashResult?: 'PAID' | 'SHORT' | 'UNPAID' | null;
}

/**
 * 调用方事务内写一行台账（状态机初始 PENDING；MATCHED/DIFF/SETTLED 由未来对账单导入推进）
 *
 * 失败路径说明：PG 事务内语句失败会进入 aborted 态，catch-warn 只对「守卫能拦住的
 * 常规异常」（重放/并发重复、mock 环境 tx 缺表）有效；真正的 DB 故障本来就会让整个
 * 调用方事务回滚，属于同一失败域。先查后写把唯一约束冲突消化在守卫层，是幂等主路径。
 */
export async function writeReconciliationLedgerTx(
  tx: Tx,
  input: WriteReconciliationLedgerInput,
): Promise<void> {
  const { orderId, orderNo, paymentMethod, amountUsd } = input;
  try {
    // 幂等守卫：同单已有台账行（重放/并发双事件）直接跳过，不依赖唯一约束报错
    const existing = await tx.reconciliationLedger.findUnique({
      where: { orderId },
      select: { id: true },
    });
    if (existing) {
      logger.warn({
        msg: 'RECON_LEDGER_DUPLICATE_SKIP',
        orderId,
        orderNo,
        paymentMethod,
        existingId: existing.id,
      });
      return;
    }

    await tx.reconciliationLedger.create({
      data: {
        orderId,
        orderNo,
        paymentMethod,
        amountUsd,
        exchangeRate: input.exchangeRate ?? null,
        amountCny: input.amountCny ?? null,
        cashResult: input.cashResult ?? null,
        status: 'PENDING',
      },
      select: { id: true },
    });

    logger.info({
      msg: 'RECON_LEDGER_WRITTEN',
      orderId,
      orderNo,
      paymentMethod,
      amountUsd,
      cashResult: input.cashResult ?? null,
    });
  } catch (e) {
    logger.warn({
      msg: 'RECON_LEDGER_WRITE_FAILED',
      orderId,
      orderNo,
      paymentMethod,
      error: (e as Error).message,
    });
  }
}
