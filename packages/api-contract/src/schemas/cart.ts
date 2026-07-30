/**
 * 购物车模块 schema
 *
 * 决策依据：
 * - schema.prisma 已有 Cart + CartItem 表
 * - 单一商家 + 多仓库：购物车不绑仓库，结算时按地址匹配
 *
 * W2 流程 C 独占：与 order schema 同源（CreateOrderRequest.items 可来自 cart）
 */
import { z } from 'zod';
import { Id, Money, IsoTimestamp, I18nText } from './common';

/** 加购请求 */
export const AddCartItemRequest = z.object({
  skuId: Id,
  quantity: z.number().int().positive(),
});

/** 修改购物车项请求 */
export const UpdateCartItemRequest = z.object({
  quantity: z.number().int().positive().optional(),
  isSelected: z.boolean().optional(),
});

/** 结算前预览请求 */
export const CheckoutPreviewRequest = z.object({
  addressId: Id,
  /** 可选优惠券码（B5：传入则后端聚合 discount，前端免二次调 validate；F13: 限 50 字符） */
  couponCode: z.string().max(50).optional(),
});

/** 批量删除购物车项请求（B2，管理模式批量删，替代 forEach N 次单删） */
export const BatchDeleteCartItemsRequest = z.object({
  itemIds: z.array(Id).min(1).max(100),
});

/** CartItem 视图 */
export const CartItem = z.object({
  id: Id,
  skuId: Id,
  productId: Id,
  productName: I18nText,
  productImage: z.string(),
  skuName: I18nText,
  unitPrice: Money,
  quantity: z.number().int().positive(),
  isSelected: z.boolean(),
  /** 当前库存（全仓库聚合实时查，B12）。undefined=无库存信息 */
  stock: z.number().int().optional(),
  addedAt: IsoTimestamp,
});

/** Cart 视图 */
export const Cart = z.object({
  id: Id,
  userId: Id,
  warehouseId: Id.nullable(),
  items: z.array(CartItem),
  selectedSubtotal: Money,
  totalSubtotal: Money,
});

/** 结算预览返回 */
export const CheckoutPreview = z.object({
  items: z.array(CartItem),
  warehouseMatch: z
    .object({
      id: Id,
      code: z.string(),
      deliveryFee: Money,
    })
    .nullable(),
  itemsSubtotal: Money,
  deliveryFee: Money,
  payableAmount: Money,
  /** 折扣金额（B5：传 couponCode 时由 promotions/validate 聚合，未传=0） */
  discount: Money,
  /** 回显传入的券码（未传=null） */
  couponCode: z.string().nullable(),
  /** 券是否有效（F12：即时校验快照，不保证下单成功，以下单事务 applyPromotion 为准） */
  couponValid: z.boolean(),
  /** 券无效原因（couponValid=false 时回显，F14，如 NOT_IN_PERIOD/BELOW_MIN_ORDER；valid=true 时 null） */
  couponReason: z.string().nullable().optional(),
  warnings: z.array(z.string()),
  /** 最早送达时间 ISO（B9，MVP now+2h 估算，未考虑仓库营业时间/运力） */
  estimatedDeliveryTime: IsoTimestamp,
});
