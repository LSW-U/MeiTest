/**
 * Cart Service — 购物车业务（DB + Redis 双层缓存）
 *
 * 决策依据：
 * - 契约 v0.3：购物车按 user 一份，DB Cart 表 + CartItem
 * - schema.prisma 已定义 Cart + CartItem（含 isSelected、product/sku 多语言快照）
 * - 单一商家 + 多仓库：购物车不绑 warehouseId，加购时不查库存（结算时按地址匹配仓库并校验）
 * - W3-C：Redis 持久化（DB 是 source of truth，Redis 作为读缓存）
 *
 * 业务规则：
 *   - add items：同 skuId 数量累加（CartItem @@unique([cartId, skuId])）
 *   - 加购时存 productName/skuName/unitPrice 快照（结算校验 + 价格变动可见性）
 *   - quantity 必须 > 0（schema Int，service 校验 ≥1）
 *   - SKU 下架后 add 拒绝，已加购的 item 显示但标 inactive
 *
 * Redis 缓存策略（W3-C）：
 *   - 命名：`cart:{userId}` → JSON 序列化的 CartView
 *   - TTL：5 分钟（短时缓存，避免长期脏数据）
 *   - 失效：任何写操作（add/update/remove/clear）后立即 DEL
 *   - 读：getCart 先查 Redis，miss 查 DB + 回填
 *   - 容错：Redis 异常不阻塞业务（catch + 降级到 DB）
 */
import { Injectable, Inject, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { PromotionService } from '../promotion/promotion.service';
import { db, findWarehouseByPoint } from '../../shared/db';
import { redis } from '../../shared/cache';
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
  /** 当前库存（全仓库聚合实时查，B12）。undefined=无库存信息。不进缓存，每次 getCart 实时补 */
  stock?: number;
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

/** Cart Redis 缓存 TTL（秒） */
const CART_CACHE_TTL_SEC = 5 * 60;

@Injectable()
export class CartService {
  constructor(@Inject(PromotionService) private readonly promotions: PromotionService) {}
  /** Redis 缓存 key：`cart:{userId}` */
  private cacheKey(userId: string): string {
    return `cart:${userId}`;
  }

  /** 失效用户购物车缓存（写操作后调，容错处理 Redis 异常） */
  private async invalidateCache(userId: string): Promise<void> {
    try {
      await redis.del(this.cacheKey(userId));
    } catch (e) {
      logger.warn({
        msg: 'CART_CACHE_INVALIDATE_FAILED',
        userId,
        error: (e as Error).message,
      });
    }
  }

  /** 写入缓存（容错） */
  private async setCache(userId: string, view: CartView): Promise<void> {
    try {
      await redis.set(
        this.cacheKey(userId),
        JSON.stringify(view),
        'EX',
        CART_CACHE_TTL_SEC,
      );
    } catch (e) {
      logger.warn({
        msg: 'CART_CACHE_SET_FAILED',
        userId,
        error: (e as Error).message,
      });
    }
  }

  /** 读购物车缓存（容错，损坏/异常返 null） */
  private async readCartCache(userId: string): Promise<CartView | null> {
    try {
      const cached = await redis.get(this.cacheKey(userId));
      if (cached) {
        try {
          return JSON.parse(cached) as CartView;
        } catch (parseErr) {
          logger.warn({
            msg: 'CART_CACHE_DESERIALIZE_FAILED',
            userId,
            error: (parseErr as Error).message,
          });
        }
      }
    } catch (e) {
      logger.warn({
        msg: 'CART_CACHE_GET_FAILED',
        userId,
        error: (e as Error).message,
      });
    }
    return null;
  }

  /**
   * 批量查询 SKU 当前库存（全仓库聚合，B12）
   * 只返回有 Stock 记录的 skuId；无记录的不在 Map 中（item.stock=undefined "无库存信息"）。
   */
  private async batchGetSkuStock(skuIds: string[]): Promise<Map<string, number>> {
    if (skuIds.length === 0) return new Map();
    const rows = await db.stock.groupBy({
      by: ['skuId'],
      where: { skuId: { in: skuIds } },
      _sum: { quantity: true },
    });
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(r.skuId, r._sum.quantity ?? 0);
    }
    return map;
  }

  /**
   * 给 CartView 的 items 实时补 stock（不写回缓存）
   *
   * stock 是关键超卖校验数据，不宜滞后；故缓存不存 stock，每次 getCart 实时补。
   * 空购物车短路（无 items 不查）。
   */
  private async withStock(view: CartView): Promise<CartView> {
    if (view.items.length === 0) return view;
    const stockMap = await this.batchGetSkuStock(view.items.map((i) => i.skuId));
    return {
      ...view,
      items: view.items.map((i) => ({ ...i, stock: stockMap.get(i.skuId) })),
    };
  }

  /** 获取（或初始化）用户购物车（带 Redis 读缓存） */
  async getCart(userId: string): Promise<CartView> {
    // 1. 先查 Redis（缓存损坏降级到 DB，不阻塞用户）
    const cached = await this.readCartCache(userId);
    if (cached) {
      // 缓存命中：stock 实时补（缓存不存 stock）
      return this.withStock(cached);
    }

    // 2. Miss 或缓存损坏：查 DB
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

    const view: CartView = {
      id: cart.id,
      userId: cart.userId,
      warehouseId: cart.warehouseId,
      items: itemViews,
      selectedSubtotal,
      totalSubtotal,
    };

    // 3. 回填 Redis（不含 stock，stock 由 withStock 实时补）
    await this.setCache(userId, view);

    // 4. 实时补 stock 后返回
    return this.withStock(view);
  }

  /** 加购 / 同 sku 累加数量 */
  async addItem(input: AddCartItemInput): Promise<CartView> {
    if (input.quantity < 1) {
      throw new ConflictException({
        code: 'E-CART-001',
        message: 'quantity must be >= 1',
      });
    }
    // M5：单次加购上限 99（防恶意刷接口或 UI bug 累加无限制）
    if (input.quantity > 99) {
      throw new ConflictException({
        code: 'E-CART-001',
        message: 'quantity must be <= 99 per add',
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

    // P1-6 修复：累加后上限校验（避免 99 + 99 = 198 超 cart 单 item 上限）
    const MAX_CART_ITEM_QTY = 999;
    const existing = await db.cartItem.findUnique({
      where: { cartId_skuId: { cartId: cart.id, skuId: sku.id } },
      select: { quantity: true },
    });
    const newQty = (existing?.quantity ?? 0) + input.quantity;
    if (newQty > MAX_CART_ITEM_QTY) {
      throw new ConflictException({
        code: 'E-CART-001',
        message: `Cart item quantity would exceed limit (${MAX_CART_ITEM_QTY}): current ${existing?.quantity ?? 0} + adding ${input.quantity} = ${newQty}`,
      });
    }

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

    // 失效缓存（下次 getCart 重读 DB）
    await this.invalidateCache(input.userId);

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

    await this.invalidateCache(input.userId);

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

    await this.invalidateCache(userId);

    return this.getCart(userId);
  }

  /** 批量删除 items（B2，管理模式批量删，单事务 deleteMany 替代 N 次 forEach） */
  async removeItems(userId: string, itemIds: string[]): Promise<CartView> {
    if (itemIds.length === 0) return this.getCart(userId);
    const cart = await db.cart.findUnique({ where: { userId } });
    if (!cart) return this.getCart(userId);
    // where 含 cartId 防越权：itemIds 中属他人购物车的 id 不匹配 cartId，自动忽略不删
    await db.cartItem.deleteMany({
      where: { id: { in: itemIds }, cartId: cart.id },
    });
    await this.invalidateCache(userId);
    return this.getCart(userId);
  }

  /**
   * 结算前校验：选中 items 的库存 + 价格是否有效
   *
   * 返回 checkoutView（订单预览，未下单）
   * 注意：本方法不锁库存（事务在 OrderService.createOrder 中），仅校验
   */
  async previewCheckout(
    userId: string,
    addressId: string,
    couponCode?: string,
  ): Promise<{
    items: CartItemView[];
    warehouseMatch: { id: string; code: string; deliveryFee: number } | null;
    itemsSubtotal: number;
    deliveryFee: number;
    payableAmount: number;
    /** 折扣金额（B5：传 couponCode 时聚合，未传=0） */
    discount: number;
    /** 回显传入的券码（未传=null） */
    couponCode: string | null;
    couponValid: boolean;
    warnings: string[];
    /** 最早送达时间 ISO（B9）。MVP 固定 now+2h 估算，未考虑仓库营业时间/运力，后续接 dispatch */
    estimatedDeliveryTime: string;
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
    const stockMap = await this.batchGetSkuStock(items.map((i) => i.skuId));
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
      stock: stockMap.get(i.skuId),
    }));

    const itemsSubtotal = itemViews.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

    // 仓库匹配（address 有 lat/lng 时）
    let warehouseMatch: { id: string; code: string; deliveryFee: number } | null = null;
    if (address.lat !== null && address.lng !== null) {
      const wh = await findWarehouseByPoint(db, Number(address.lng), Number(address.lat));
      if (wh) {
        warehouseMatch = { id: wh.id, code: wh.code, deliveryFee: wh.deliveryFee };
      } else {
        warnings.push('ADDRESS_OUT_OF_DELIVERY_RANGE');
      }
    }

    const deliveryFee = warehouseMatch?.deliveryFee ?? 0;
    // B5：聚合 discount（传 couponCode 时调 promotions/validate，前端免二次请求 + 金额一致）
    // 注（F12）：couponValid 是即时校验快照，不保证下单成功——下单走 applyPromotion 事务内
    // 重新校验 + increment usedCount，preview 与下单间存在 TOCTOU（券可能被用完），金额以下单事务为准。
    let discount = 0;
    let couponValid = false;
    if (couponCode) {
      const validation = await this.promotions.validatePromotion(couponCode, itemsSubtotal, deliveryFee);
      discount = validation.discount;
      couponValid = validation.valid;
    }
    const payableAmount = itemsSubtotal + deliveryFee - discount;
    // B9：ETA 简单估算 = now + 2h（MVP 不考虑仓库营业时间/运力，后续接 dispatch 算法）
    const estimatedDeliveryTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    return {
      items: itemViews,
      warehouseMatch,
      itemsSubtotal,
      deliveryFee,
      discount,
      couponCode: couponCode ?? null,
      couponValid,
      payableAmount,
      warnings,
      estimatedDeliveryTime,
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

    await this.invalidateCache(userId);
  }

  /** 取得（或自动创建）购物车 */
  private async getOrCreateCart(userId: string) {
    const existing = await db.cart.findUnique({ where: { userId } });
    if (existing) return existing;
    return db.cart.create({ data: { userId } });
  }
}
