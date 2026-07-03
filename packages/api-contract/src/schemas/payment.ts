/**
 * 支付模块 schema（业务层视图，contract order.ts 已有 PaymentMethod / PaymentStatus 枚举）
 *
 * 决策依据：
 * - 契约 v0.3 决策 D：5 支付方式（COD/BANK/WECHAT/PAYPAL/STRIPE）
 * - W1 已实现 infrastructure/payment 5 策略
 * - 本模块提供 PaymentIntentView、各场景的 Request schema
 *
 * W2 流程 C 独占：与 order 配套
 */
import { z } from 'zod';
import { Id, Money, IsoTimestamp } from './common';
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

/** 支付方式列表项（W7 P1-1） */
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
  /** 是否为 mock/stub 实现（dev/staging WECHAT/PAYPAL/STRIPE 为 true） */
  mockFlag: z.boolean(),
});

/** 支付方式列表响应 */
export const PaymentMethodListResponseData = z.object({
  items: z.array(PaymentMethodItem),
});
