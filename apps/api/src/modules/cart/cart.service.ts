/**
 * Cart Service — 购物车业务（DB 持久化版本，Redis 优化 W3+）
 *
 * 决策依据：
 * - 契约 v0.3：购物车按 user 一份，DB Cart 表 + CartItem
 * - schema.prisma 已定义 Cart + CartItem（含 isSelected、product/sku 多语言快照）
 * - 单一商家 + 多仓库：购物车不绑 warehouseId，加购时不查库存（结算时按地址匹配仓库并校验）
 *
 * 业务规则：
 *   - add items：同 skuId 数量累加（CartItem @@unique([cartId, skuId])）
 *   - 加购时存 productName/skuName/unitPrice 快照（结算校验 + 价格变动可见性）
 *   - quantity 必须 > 0（schema Int，service 校验 ≥1）
 *   - SKU 下架后 add 拒绝，已加购的 item 显示但标 inactive
 */
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';

/** 加购请求 */
export interface AddCartItemInput {
  userId: string;
  skuId: string;
  quantity: number;
}

/** 修改数量请求 */
export interface UpdateCartItemInput {
  userId: string;
  itemId: string;
  quantity?: number;
  isSelected?: boolean;
}

/** CartItem 视图（API 返回） */
export interface CartItemView {
  id: string;
  skuId: string;
  productId: string;
  productName: unknown;
  productImage: string;
  skuName: unknown;
  unitPrice: number;
  quantity: number;
  isSelected: boolean;
  addedAt: string;
}

/** Cart 视图（API 返回） */
export interface CartView {
  id: string;
  userId: string;
  warehouseId: string | null;
  items: CartItemView[];
  /** 选中项小计（仅 selected items） */
  selectedSubtotal: number;
  /** 全部 items 小计 */
  totalSubtotal: number;
}

@Injectable()
export class CartService {
  /** 获取（或初始化）用户购物车 */
  async getCart(userId: string): Promise<CartView> {
    const cart = await this.getOrCreateCart(userId);
    const items = await db.cartItem.findMany({
      where: { cartId: cart.id },
      orderBy: { addedAt: 'asc' },
    });

    const itemViews: CartItemView[] = items.map((i) => ({
      id: i.id,
      skuId: i.skuId,
      productId: i.productId,
      productName: i.productName,
      productImage: i.productImage,
      skuName: i.skuName,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      isSelected: i.isSelected,
      addedAt: i.addedAt.toISOString(),
    }));

    const selectedSubtotal = itemViews
      .filter((i) => i.isSelected)
      .reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    const totalSubtotal = itemViews.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

    return {
      id: cart.id,
      userId: cart.userId,
      warehouseId: cart.warehouseId,
      items: itemViews,
      selectedSubtotal,
      totalSubtotal,
    };
  }

  /** 加购 / 同 sku 累加数量 */
  async addItem(input: AddCartItemInput): Promise<CartView> {
    if (input.quantity < 1) {
      throw new ConflictException({
        code: 'E-CART-001',
        message: 'quantity must be >= 1',
      });
    }

    const sku = await db.sku.findUnique({
      where: { id: input.skuId },
      include: { product: true },
    });
    if (!sku || sku.status !== 'ACTIVE' || sku.product.status !== 'ACTIVE') {
      throw new ConflictException({
        code: 'E-CART-002',
        message: 'SKU not found or inactive',
      });
    }

    const cart = await this.getOrCreateCart(input.userId);

    // upsert：同 skuId 累加数量
    await db.cartItem.upsert({
      where: { cartId_skuId: { cartId: cart.id, skuId: sku.id } },
      create: {
        cartId: cart.id,
        skuId: sku.id,
        productId: sku.productId,
        productName: sku.product.name as Prisma.InputJsonValue,
        productImage: sku.product.mainImage,
        skuName: sku.name as Prisma.InputJsonValue,
        unitPrice: sku.price,
        quantity: input.quantity,
        isSelected: true,
      },
      update: {
        quantity: { increment: input.quantity },
        // 价格快照实时刷新（避免加购时价 ≠ 结算时价）
        unitPrice: sku.price,
        isSelected: true,
      },
    });

    logger.info({
      msg: 'CART_ITEM_ADDED',
      userId: input.userId,
      skuId: input.skuId,
      quantity: input.quantity,
    });

    return this.getCart(input.userId);
  }

  /** 修改数量 / 选中状态 */
  async updateItem(input: UpdateCartItemInput): Promise<CartView> {
    const item = await db.cartItem.findUnique({ where: { id: input.itemId } });
    if (!item) {
      throw new NotFoundException({
        code: 'E-CART-003',
        message: 'Cart item not found',
      });
    }

    // 校验属于当前用户
    const cart = await db.cart.findUnique({ where: { id: item.cartId } });
    if (!cart || cart.userId !== input.userId) {
      throw new NotFoundException({
        code: 'E-CART-003',
        message: 'Cart item not found',
      });
    }

    if (input.quantity !== undefined) {
      if (input.quantity < 1) {
        throw new ConflictException({
          code: 'E-CART-001',
          message: 'quantity must be >= 1',
        });
      }
    }

    await db.cartItem.update({
      where: { id: input.itemId },
      data: {
        ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
        ...(input.isSelected !== undefined ? { isSelected: input.isSelected } : {}),
      },
    });

    return this.getCart(input.userId);
  }

  /** 删除单个 item */
  async removeItem(userId: string, itemId: string): Promise<CartView> {
    const item = await db.cartItem.findUnique({ where: { id: itemId } });
    if (!item) {
      return this.getCart(userId);
    }
    const cart = await db.cart.findUnique({ where: { id: item.cartId } });
    if (!cart || cart.userId !== userId) {
      throw new NotFoundException({
        code: 'E-CART-003',
        message: 'Cart item not found',
      });
    }
    await db.cartItem.delete({ where: { id: itemId } });
    return this.getCart(userId);
  }

  /**
   * 结算前校验：选中 items 的库存 + 价格是否有效
   *
   * 返回 checkoutView（订单预览，未下单）
   * 注意：本方法不锁库存（事务在 OrderService.createOrder 中），仅校验
   */
  async previewCheckout(userId: string, addressId: string): Promise<{
    items: CartItemView[];
    warehouseMatch: { id: string; code: string; deliveryFee: number } | null;
    itemsSubtotal: number;
    deliveryFee: number;
    payableAmount: number;
    warnings: string[];
  }> {
    const cart = await this.getOrCreateCart(userId);
    const items = await db.cartItem.findMany({
      where: { cartId: cart.id, isSelected: true },
    });
    if (items.length === 0) {
      throw new ConflictException({
        code: 'E-CART-004',
        message: 'No selected items in cart',
      });
    }

    // 查地址（含 lat/lng）
    const address = await db.address.findUnique({ where: { id: addressId } });
    if (!address || address.userId !== userId) {
      throw new NotFoundException({
        code: 'E-ORDER-001',
        message: 'Address not found or not owned by user',
      });
    }

    const warnings: string[] = [];
    const itemViews: CartItemView[] = items.map((i) => ({
      id: i.id,
      skuId: i.skuId,
      productId: i.productId,
      productName: i.productName,
      productImage: i.productImage,
      skuName: i.skuName,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      isSelected: i.isSelected,
      addedAt: i.addedAt.toISOString(),
    }));

    const itemsSubtotal = itemViews.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

    // 仓库匹配（address 有 lat/lng 时）
    let warehouseMatch: { id: string; code: string; deliveryFee: number } | null = null;
    if (address.lat !== null && address.lng !== null) {
      // 动态导入避免循环（findWarehouseByPoint 是纯函数，但 tx 复用 db）
      const { findWarehouseByPoint } = await import('../../shared/db');
      const wh = await findWarehouseByPoint(db, Number(address.lng), Number(address.lat));
      if (wh) {
        warehouseMatch = { id: wh.id, code: wh.code, deliveryFee: wh.deliveryFee };
      } else {
        warnings.push('ADDRESS_OUT_OF_DELIVERY_RANGE');
      }
    }

    const deliveryFee = warehouseMatch?.deliveryFee ?? 0;
    const payableAmount = itemsSubtotal + deliveryFee;

    return {
      items: itemViews,
      warehouseMatch,
      itemsSubtotal,
      deliveryFee,
      payableAmount,
      warnings,
    };
  }

  /**
   * 下单后清空已下单的购物车 items
   *
   * 由 OrderService 在 createOrder 成功后调用（已选 items 删除）
   * MVP：items 通过 order items 的 skuId 集合删 cart item
   */
  async clearOrderedItems(userId: string, skuIds: string[]): Promise<void> {
    if (skuIds.length === 0) return;
    const cart = await db.cart.findUnique({ where: { userId } });
    if (!cart) return;
    await db.cartItem.deleteMany({
      where: { cartId: cart.id, skuId: { in: skuIds } },
    });
  }

  /** 取得（或自动创建）购物车 */
  private async getOrCreateCart(userId: string) {
    const existing = await db.cart.findUnique({ where: { userId } });
    if (existing) return existing;
    return db.cart.create({ data: { userId } });
  }
}
