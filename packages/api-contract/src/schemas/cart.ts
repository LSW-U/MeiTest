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
  warnings: z.array(z.string()),
});
