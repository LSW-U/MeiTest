/**
 * Order 模块类型定义
 *
 * 决策依据：
 * - 契约 v0.3 决策 A：orderNo 16 位 = MM + yyyyMMdd(8) + warehouseId(2位) + 序号(4位)
 * - 契约 v0.3 决策 D：5 枚举 PaymentMethod（COD/BANK/WECHAT/PAYPAL/STRIPE）
 * - 契约 v0.3 冲突 6：Order 必加 warehouseId
 * - 契约 v0.3 冲突 10：订单状态机扩展（PENDING_PAYMENT 预付起点 / DELIVERED_PAID / DELIVERED_UNPAID）
 * - schema.prisma OrderStatus enum 已定义（与 contract OrderStatus zod enum 同步）
 *
 * 类型对齐：
 *   - contract（小写字面量）：DeviceType 'client_app' / 'rider_app' / 'admin_web'
 *   - Prisma（大写 enum）：DeviceType CLIENT_APP / RIDER_APP / ADMIN_WEB
 *   用 toPrismaDeviceType 在写入 DB 前转换
 */
import type { DeviceType } from '@meimart/api-contract';
import type {
  OrderStatus as PrismaOrderStatus,
  PaymentMethod as PrismaPaymentMethod,
  PaymentStatus as PrismaPaymentStatus,
  OrderEventType,
} from '../../prisma/client';

/** 重新导出 Prisma enum 让 service 用本地类型（与 DB 一致，避免 contract 字符串字面量散落） */
export type OrderStatusValue = PrismaOrderStatus;
export type PaymentMethodValue = PrismaPaymentMethod;
export type PaymentStatusValue = PrismaPaymentStatus;
export type OrderEventTypeValue = OrderEventType;

/** contract DeviceType（小写） — 用于入参（JWT RequestUser 来源） */
export type ContractDeviceType = DeviceType;

/** 下单请求 DTO（contract CreateOrderRequest 的 service 内部表示） */
export interface CreateOrderInput {
  userId: string;
  addressId: string;
  items: Array<{ skuId: string; quantity: number }>;
  remark?: string;
  paymentMethod: PaymentMethodValue;
  /** 设备类型（审计用，contract 小写） */
  deviceType: ContractDeviceType;
  /** 操作视角（审计用） */
  perspective?: string;
  /** 促销码（W7-ext-G，可选） */
  promoCode?: string;
}

/** 下单后返回（service → controller → client） */
export interface CreatedOrder {
  id: string;
  orderNo: string;
  status: OrderStatusValue;
  warehouseId: string;
  totalAmount: number;
  deliveryFee: number;
  discountAmount: number;
  payableAmount: number;
  paymentMethod: PaymentMethodValue;
  paymentStatus: PaymentStatusValue;
  /** 预付场景下，第三方支付的客户端凭证（mock/stub 也是 stub_xxx） */
  paymentClientSecret?: string;
  /** mock/stub 标识（前端展示"测试模式"badge） */
  paymentMockFlag: boolean;
  /** 订单商品快照列表（与 GET /client/orders/:id 一致） */
  items: CreatedOrderItem[];
  createdAt: string;
}

/** 订单商品快照（创建时多语言 JSON 已写入 OrderItem） */
export interface CreatedOrderItem {
  id: string;
  productId: string;
  skuId: string;
  productName: Record<string, string>;
  productImage: string;
  skuName: Record<string, string>;
  unitPrice: number;
  quantity: number;
  subtotal: number;
}

/** OrderEvent 写入上下文（OrderEvent 表用） */
export interface OrderEventContext {
  operatorId?: string;
  /** contract deviceType 小写（'client_app' / 'rider_app' / 'admin_web'） */
  deviceType?: ContractDeviceType;
  perspective?: string;
  metadata?: Record<string, unknown>;
}

/** Prisma deviceType enum（大写）— 用于 OrderEvent / AuditLog 持久化 */
export type PrismaDeviceType = 'CLIENT_APP' | 'RIDER_APP' | 'ADMIN_WEB' | 'SYSTEM';

/**
 * JWT 小写 deviceType（contract 'client_app' 等）→ Prisma enum 大写（'CLIENT_APP' 等）
 *
 * 用于 OrderEvent.deviceType / AuditLog.deviceType 字段持久化。
 * 与 shared/interceptors/audit.interceptor.ts:toPrismaDeviceType 同语义。
 *
 * V2-S5 修复：新增 'system' → 'SYSTEM'（用于 BullMQ / cron / 内部回调）
 *
 * @returns null 当 d 为 undefined（数据库字段允许 null）
 */
export function toPrismaDeviceType(
  d: ContractDeviceType | undefined,
): PrismaDeviceType | null {
  if (!d) return null;
  if (d === 'client_app') return 'CLIENT_APP';
  if (d === 'rider_app') return 'RIDER_APP';
  if (d === 'admin_web') return 'ADMIN_WEB';
  if (d === 'system') return 'SYSTEM';
  return null;
}
