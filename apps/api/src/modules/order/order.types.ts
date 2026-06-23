/**
 * Order 模块类型定义
 *
 * 决策依据：
 * - 契约 v0.3 决策 A：orderNo 16 位 = MM + yyyyMMdd(8) + warehouseId(2位) + 序号(4位)
 * - 契约 v0.3 决策 D：5 枚举 PaymentMethod（COD/BANK/WECHAT/PAYPAL/STRIPE）
 * - 契约 v0.3 冲突 6：Order 必加 warehouseId
 * - 契约 v0.3 冲突 10：订单状态机扩展（PENDING_PAYMENT 预付起点 / DELIVERED_PAID / DELIVERED_UNPAID）
 * - schema.prisma OrderStatus enum 已定义（与 contract OrderStatus zod enum 同步）
 */
import type { OrderStatus, PaymentMethod } from '@meimart/api-contract';
import type {
  OrderStatus as PrismaOrderStatus,
  PaymentMethod as PrismaPaymentMethod,
  PaymentStatus as PrismaPaymentStatus,
  OrderEventType,
  DeviceType,
} from '../../prisma/client';

/** 重新导出 Prisma enum 让 service 用本地类型（与 DB 一致，避免 contract 字符串字面量散落） */
export type OrderStatusValue = PrismaOrderStatus;
export type PaymentMethodValue = PrismaPaymentMethod;
export type PaymentStatusValue = PrismaPaymentStatus;
export type OrderEventTypeValue = OrderEventType;

/** 下单请求 DTO（contract CreateOrderRequest 的 service 内部表示） */
export interface CreateOrderInput {
  userId: string;
  addressId: string;
  items: Array<{ skuId: string; quantity: number }>;
  remark?: string;
  paymentMethod: PaymentMethodValue;
  /** 设备类型（审计用） */
  deviceType: DeviceType;
  /** 操作视角（审计用） */
  perspective?: string;
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
}

/** OrderEvent 写入上下文（OrderEvent 表用） */
export interface OrderEventContext {
  operatorId?: string;
  deviceType?: DeviceType;
  perspective?: string;
  metadata?: Record<string, unknown>;
}

/** 类型守卫：contract OrderStatus 与 Prisma OrderStatus 字符串字面量一致 */
export function toPrismaOrderStatus(status: OrderStatus): PrismaOrderStatus {
  return status as PrismaOrderStatus;
}

/** 类型守卫：contract PaymentMethod 与 Prisma PaymentMethod 字符串字面量一致 */
export function toPrismaPaymentMethod(method: PaymentMethod): PrismaPaymentMethod {
  return method as PrismaPaymentMethod;
}
