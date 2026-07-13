/**
 * 订单模块 schema
 *
 * 决策依据：
 * - 契约 v0.3 决策 A：orderNo 16 位 = MM + yyyyMMdd + warehouseId(2位) + 序号(4位)
 * - 契约 v0.3 决策 D：5 枚举 PaymentMethod（COD/BANK/WECHAT/PAYPAL/STRIPE）
 * - 契约 v0.3 冲突 6：Order 加 warehouseId
 * - 契约 v0.3 冲突 10：订单状态机扩展（PENDING_PAYMENT 预付起点 / DELIVERED_PAID / DELIVERED_UNPAID）
 * - 业务决策 2：多仓库，order 实体含 warehouseId
 * - CLAUDE.md §Token 策略 / §orderNo 格式
 */
import { z } from 'zod';
import { Id, IsoTimestamp, Money } from './common';

/** 16 位订单号：MM + yyyyMMdd(8) + warehouseId(2) + 序号(4) */
export const OrderNo = z.string().regex(/^MM\d{14}$/, 'ORDER_NO_FORMAT: 16 位');

/** 5 种支付方式（v0.3 决策 D） */
export const PaymentMethod = z.enum([
  'COD',
  'BANK_TRANSFER',
  'WECHAT',
  'PAYPAL',
  'STRIPE',
]);

/**
 * 订单状态机（v0.3 冲突 10 扩展）
 *
 * 流程：
 *   CART
 *     ↓ COD / BANK_TRANSFER
 *   PENDING_CONFIRM
 *     ↓ 预付（WECHAT / PAYPAL / STRIPE）
 *   PENDING_PAYMENT
 *     ↓ 支付成功
 *   CONFIRMED → PICKED → OUT_FOR_DELIVERY
 *     ↓ COD 收款                  ↓ 预付已付
 *   DELIVERED_PAID                DELIVERED
 *     ↓
 *   COMPLETED
 *
 * 异常：
 *   OUT_FOR_DELIVERY → DELIVERED_UNPAID（COD 拒付）
 *   任意 → CANCELLED
 */
export const OrderStatus = z.enum([
  'PENDING_PAYMENT',
  'PENDING_CONFIRM',
  'CONFIRMED',
  'PICKED',
  'OUT_FOR_DELIVERY',
  'DELIVERED_PAID',
  'DELIVERED',
  'DELIVERED_UNPAID',
  'COMPLETED',
  'CANCELLED',
]);

export const PaymentStatus = z.enum(['UNPAID', 'PAID', 'REFUNDED']);

/** 收货地址快照（下单时拷贝） */
export const AddressSnapshot = z.object({
  name: z.string(),
  phone: z.string(),
  detail: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
});

/** 订单项（含下单时价格快照） */
export const OrderItem = z.object({
  id: Id,
  productId: Id,
  skuId: Id,
  productName: z.string(),
  productImage: z.string(),
  skuName: z.string(),
  unitPrice: Money,
  quantity: z.number().int().positive(),
  subtotal: Money,
});

/** 订单实体（含 warehouseId，按收货地址 PostGIS 匹配） */
export const Order = z.object({
  id: Id,
  orderNo: OrderNo,
  userId: Id,
  warehouseId: Id,
  status: OrderStatus,
  items: z.array(OrderItem),
  totalAmount: Money,
  deliveryFee: Money,
  discountAmount: Money.default(0),
  payableAmount: Money,
  deliveryAddress: AddressSnapshot,
  remark: z.string().nullable(),
  riderId: Id.nullable(),
  paymentMethod: PaymentMethod,
  paymentStatus: PaymentStatus,
  paidAt: IsoTimestamp.nullable(),
  createdAt: IsoTimestamp,
  confirmedAt: IsoTimestamp.nullable(),
  pickedAt: IsoTimestamp.nullable(),
  deliveringAt: IsoTimestamp.nullable(),
  deliveredAt: IsoTimestamp.nullable(),
  cancelledAt: IsoTimestamp.nullable(),
  cancelReason: z.string().nullable(),
  /** 应用的促销（W7-ext-G-fix2）：null = 未用码 */
  promotion: z
    .object({
      promotionId: Id,
      code: z.string(),
      discountAmount: z.number().int(),
    })
    .nullable(),
});

/** Admin 编辑订单请求（W7-ext-C）：MVP 仅允许改 remark */
export const UpdateOrderRequest = z.object({
  remark: z.string().max(200).nullable().optional(),
});

/** 创建订单请求（同步事务 MVP） */
export const CreateOrderRequest = z.object({
  addressId: Id,
  items: z
    .array(
      z.object({
        skuId: Id,
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  remark: z.string().max(200).optional(),
  paymentMethod: PaymentMethod,
});

/** 取消订单请求 */
export const CancelOrderRequest = z.object({
  reason: z.string().min(1).max(200),
});
