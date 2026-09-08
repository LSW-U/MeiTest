/**
 * 支付模块 schema（业务层视图，contract order.ts 已有 PaymentMethod / PaymentStatus 枚举）
 *
 * 决策依据：
 * - 契约 v0.3 决策 D：5 支付方式（COD/BANK/WECHAT/PAYPAL/STRIPE）+ 批B 补位 3 占位渠道
 * - W1 已实现 infrastructure/payment 5 策略 + 批B 3 stub（WECHAT_GLOBAL/ALIPAY_CN/LOCAL_PSP）
 * - 本模块提供 PaymentIntentView、各场景的 Request schema
 *
 * W2 流程 C 独占：与 order 配套
 */
import { z } from 'zod';
import { Id, Money, IsoTimestamp, PaginatedResponse, OffsetPaginatedResponse } from './common';
import { PaymentMethod, PaymentStatus } from './order';

/** 重导出（与 order schema 共用，避免 import 跨模块） */
export { PaymentMethod, PaymentStatus };

/** PaymentIntent 业务视图（API 返回） */
export const PaymentIntent = z.object({
  id: Id,
  orderId: Id,
  method: PaymentMethod,
  status: PaymentStatus,
  amount: Money,
  transactionId: z.string().nullable(),
  clientSecret: z.string().nullable(),
  receiptUrl: z.string().url().nullable(),
  /** mock/stub 标识（W7 上线前 checklist 用，prod 切真后应全 false） */
  mockFlag: z.boolean(),
  paidAt: IsoTimestamp.nullable(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

/** 凭证上传请求 */
export const UploadReceiptRequest = z.object({
  receiptUrl: z.string().url(),
});

/** 支付方式列表项（W7 P1-1 + 批B available） */
export const PaymentMethodItem = z.object({
  code: PaymentMethod,
  /** 多语言名称（按 Accept-Language 取值） */
  name: z.record(z.string(), z.string()),
  /** 多语言副标题（描述/提示） */
  subtitle: z.record(z.string(), z.string()),
  /** 图标标识（前端按 code 渲染本地资源） */
  icon: z.string(),
  /** 是否为默认方式（前端列表默认选中） */
  isDefault: z.boolean(),
  /** 是否启用（false 时不在列表展示） */
  enabled: z.boolean(),
  /** 是否可下单（批B：false = 占位渠道，列表可见"即将上线"但不可选中，服务端拒绝下单） */
  available: z.boolean(),
  /** 是否为 mock/stub 实现（dev/staging WECHAT/PAYPAL/STRIPE/WECHAT_GLOBAL/ALIPAY_CN/LOCAL_PSP 为 true） */
  mockFlag: z.boolean(),
});

/** 支付方式列表响应 */
export const PaymentMethodListResponseData = z.object({
  items: z.array(PaymentMethodItem),
});

// ============================================================================
// Admin（批次 3：admin payment 透视）
// ============================================================================

/** PaymentIntent admin 视图（扩展 + orderNo/userId/warehouseId，join order 取） */
export const PaymentIntentAdminView = PaymentIntent.extend({
  orderNo: z.string(),
  userId: Id,
  warehouseId: Id,
});

/** 退款摘要（admin payment 详情内嵌） */
export const RefundSummary = z.object({
  id: Id,
  amount: Money,
  status: PaymentStatus.optional(), // refund status 实际是 RefundStatus enum，此处宽松
  reason: z.string(),
});

/** PaymentIntent admin 详情（含 order + order.refunds） */
export const PaymentIntentAdminDetail = PaymentIntentAdminView.extend({
  order: z.object({
    orderNo: z.string(),
    userId: Id,
    warehouseId: Id,
    status: z.string(),
    refunds: z.array(RefundSummary),
  }),
});

/** admin 列表查询（游标分页 + filter） */
export const ListPaymentIntentsQuery = z.object({
  status: PaymentStatus.optional(),
  method: PaymentMethod.optional(),
  orderId: Id.optional(),
  orderNo: z.string().optional(),
  /** query string 传 'true'/'false'，controller 转 boolean */
  mockFlag: z.enum(['true', 'false']).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

/** admin 列表响应（游标分页） */
export const PaymentIntentListResponse = PaginatedResponse(PaymentIntentAdminView);

/** 标失败请求（手动标 PaymentIntent FAILED） */
export const MarkFailedRequest = z.object({
  reason: z.string().min(1).max(500),
});

/** 对账汇总项（group by status + method） */
export const ReconciliationItem = z.object({
  status: PaymentStatus,
  method: PaymentMethod,
  count: z.number().int(),
  totalAmount: Money,
});

// ============================================================================
// 对账台账（批C 对账分流，微信支付预留 2026-09-08，方案V2 §3.3）
//   统一承载 COD 现金与线上两股资金流；对账单导入本轮只预留（D7）
// ============================================================================

/** 台账状态机（ReconciliationLedger.status） */
export const ReconciliationLedgerStatus = z.enum(['PENDING', 'MATCHED', 'DIFF', 'SETTLED']);

/** COD 收款结果（ReconciliationLedger.cashResult，口径同 CashCollection.result） */
export const LedgerCashResult = z.enum(['PAID', 'SHORT', 'UNPAID']);

/** 台账行视图（GET /admin/reconciliation/ledgers 列表项） */
export const ReconciliationLedgerView = z.object({
  id: Id,
  orderId: Id,
  /** 订单号快照（免 join 排查主键） */
  orderNo: z.string(),
  /** 资金渠道（与 PaymentIntent.method 同枚举） */
  method: PaymentMethod,
  /** 实收金额（分，USD）：COD=骑手实收（UNPAID=0）；线上/银行=PaymentIntent.amount */
  amountUsd: Money,
  /** 汇率快照（万分位；纯 USD 资金流为 null） */
  exchangeRate: z.number().int().nullable(),
  /** 人民币金额（分）；纯 USD 资金流为 null */
  amountCny: z.number().int().nullable(),
  /** COD 收款结果；线上渠道为 null */
  cashResult: LedgerCashResult.nullable(),
  /** 台账状态机 */
  status: ReconciliationLedgerStatus,
  /** 对账单导入批次（本轮预留，恒 null） */
  statementBatchId: Id.nullable(),
  createdAt: IsoTimestamp,
});

/** 台账列表查询（offset 分页，复用 ImportLog 模式） */
export const ListReconciliationLedgersQuery = z.object({
  method: PaymentMethod.optional(),
  status: ReconciliationLedgerStatus.optional(),
  /** 订单号模糊匹配（contains） */
  orderNo: z.string().optional(),
  /** 日期区间（ISO，含 from 不含 to；落 createdAt） */
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

/** 台账列表响应（offset 分页） */
export const ReconciliationLedgerListResponse = OffsetPaginatedResponse(ReconciliationLedgerView);

/** 台账分区汇总行（group by method + cashResult；admin 三区展示数据源） */
export const ReconciliationLedgerSummaryItem = z.object({
  method: PaymentMethod,
  /** COD 才有值；非 COD 渠道为 null */
  cashResult: LedgerCashResult.nullable(),
  count: z.number().int(),
  totalAmountUsd: Money,
  /** 全组无人民币金额时为 0（COD/BANK_TRANSFER 均 null 求和） */
  totalAmountCny: Money,
});

/** 台账分区汇总响应 */
export const ReconciliationLedgerSummaryResponseData = z.object({
  items: z.array(ReconciliationLedgerSummaryItem),
});

/** 对账单导入批次视图（GET /admin/reconciliation/import-batches，预留入口） */
export const StatementImportBatchView = z.object({
  id: Id,
  fileName: z.string(),
  /** 对账单格式 */
  format: z.enum(['WECHAT', 'ALIPAY', 'BANK']),
  rowCount: z.number().int(),
  successCount: z.number().int(),
  failedCount: z.number().int(),
  /** IMPORTED / PARTIAL / FAILED */
  status: z.string(),
  operatorId: z.string().nullable(),
  createdAt: IsoTimestamp,
});

/** 导入批次列表响应（offset 分页） */
export const StatementImportBatchListResponse = OffsetPaginatedResponse(StatementImportBatchView);
