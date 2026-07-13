/**
 * Order Service — 订单核心业务
 *
 * 决策依据：
 * - 契约 v0.3 决策 A：orderNo 16 位（Redis INCR + 时区 Asia/Dili）
 * - 契约 v0.3 冲突 6：Order 必含 warehouseId（PostGIS 匹配）
 * - 契约 v0.3 冲突 9：同步事务下单 + 行锁防超卖
 * - CLAUDE.md §业务决策 4：MVP 同步事务
 *
 * 下单流程（createOrder）：
 *   1. 查 Address（含 lat/lng），无则抛 E-ORDER-001
 *   2. PostGIS findWarehouseByPoint 匹配最近仓库，无则抛 E-ORDER-001
 *   3. 一次性查所有 SKU（含 product 多语言 + 价格），任何一个无效抛 E-ORDER-005
 *   4. 计算金额（itemsSubtotal + deliveryFee - discount = payable）
 *   5. 生成 orderNo（Redis INCR，事务前生成，避免事务内调 Redis）
 *   6. withTransaction：
 *      a. 创建 Order（含 orderNo + warehouseId + 状态机初始态）
 *      b. 创建 OrderItem[]（含多语言快照）
 *      c. 对每个 sku 调 deductStock 行锁扣库存，任一失败 → throw + 自动回滚
 *      d. 写 OrderEvent(CREATED)
 *   7. 事务后调 PaymentService.createIntentForOrder（如失败 → 自动取消订单）
 *   8. 返回 CreatedOrder（含 paymentClientSecret 供前端跳转第三方）
 *
 * 取消流程（cancelOrder）：
 *   1. 查 Order，校验状态可取消（isUserCancellable）
 *   2. withTransaction：
 *      a. 释放库存（releaseStock 对每个 OrderItem）
 *      b. 更新 Order.status=CANCELLED + cancelledAt + cancelReason
 *      c. 写 OrderEvent(CANCELLED)
 *   3. （预付场景）W5 接入 RefundService：触发 refund，标 PaymentIntent.REFUNDED
 */
import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db, withTransaction, deductStock, releaseStock, findWarehouseByPoint } from '../../shared/db';
import type { Tx } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { OrderNoService } from './order-no.service';
import { getInitialState, assertCanTransition, isUserCancellable } from './order-status.machine';
import type {
  CreateOrderInput,
  CreatedOrder,
  OrderStatusValue,
  PaymentMethodValue,
  OrderEventContext,
  ContractDeviceType,
} from './order.types';
import { toPrismaDeviceType } from './order.types';
import type { PaymentService } from '../payment/payment.service';
import { PromotionService } from '../promotion/promotion.service';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ORDER_TIMEOUT_QUEUE } from '../../shared/queue';
import {
  enqueueOrderTimeout,
  cancelOrderTimeout,
  type OrderTimeoutJobData,
} from './order-timeout.helper';

/** DispatchService 接口（避免直接 import DispatchService 形成强耦合 + 循环 import） */
interface DispatchServiceLike {
  createTaskForOrder(orderId: string): Promise<unknown>;
}

/** CartService 接口（避免直接 import CartService 形成 Order ↔ Cart 循环依赖） */
interface CartServiceLike {
  clearOrderedItems(userId: string, skuIds: string[]): Promise<void>;
}

/** Order 查询结果（含 items + events） */
export interface OrderWithRelations {
  id: string;
  orderNo: string;
  userId: string;
  warehouseId: string;
  status: OrderStatusValue;
  totalAmount: number;
  deliveryFee: number;
  discountAmount: number;
  payableAmount: number;
  deliveryAddress: unknown;
  remark: string | null;
  riderId: string | null;
  paymentMethod: PaymentMethodValue;
  paymentStatus: string;
  paidAt: string | null;
  createdAt: string;
  confirmedAt: string | null;
  pickedAt: string | null;
  deliveringAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  items: Array<{
    id: string;
    productId: string;
    skuId: string;
    productName: unknown;
    productImage: string;
    skuName: unknown;
    unitPrice: number;
    quantity: number;
    subtotal: number;
  }>;
  events: Array<{
    id: string;
    eventType: string;
    fromStatus: OrderStatusValue | null;
    toStatus: OrderStatusValue;
    operatorId: string | null;
    metadata: unknown;
    createdAt: string;
  }>;
}

@Injectable()
export class OrderService {
  constructor(
    @Inject(OrderNoService) private readonly orderNoService: OrderNoService,
    @Inject('PaymentServiceToken') private readonly paymentService: PaymentService,
    @InjectQueue(ORDER_TIMEOUT_QUEUE) private readonly timeoutQueue: Queue<OrderTimeoutJobData>,
    @Inject('DISPATCH_SERVICE_TOKEN')
    private readonly dispatchService: DispatchServiceLike | null,
    @Inject('CART_SERVICE_TOKEN')
    private readonly cartService: CartServiceLike | null,
    @Inject(PromotionService) private readonly promotionService: PromotionService,
    @Inject('RealtimeGatewayToken')
    private readonly realtime: {
      broadcastOrderStatusChange: (
        orderId: string,
        payload: {
          fromStatus: string;
          toStatus: string;
          operatorId?: string;
          reason?: string;
        },
      ) => void;
    } | null,
    @Inject('NotifyFactoryToken')
    private readonly notifyFactory: {
      sendMulti: (
        request: {
          userId: string;
          type: string;
          title: Record<string, string>;
          body: Record<string, string>;
        },
        channels: string[],
      ) => Promise<unknown>;
    } | null,
  ) {}

  /**
   * 创建订单（同步事务）
   *
   * 业务异常：
   *   - E-ORDER-001 地址不在配送范围（含地址不存在 / 无仓库覆盖）
   *   - E-ORDER-002 库存不足
   *   - E-ORDER-005 SKU 无效或已下架
   *   - E-COMMON-002 内部错误（事务异常）
   */
  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    // ===== Step 1: 查地址 =====
    const address = await db.address.findUnique({
      where: { id: input.addressId },
    });
    if (!address || address.userId !== input.userId) {
      throw new NotFoundException({
        code: 'E-ORDER-001',
        message: 'Delivery address not found or not owned by user',
      });
    }
    if (address.lat === null || address.lng === null) {
      throw new ConflictException({
        code: 'E-ORDER-001',
        message: 'Delivery address missing lat/lng, please pick a point on map',
      });
    }

    // ===== Step 2: PostGIS 匹配最近仓库 =====
    // 注意：findWarehouseByPoint 用 db（不是 tx），read-only 不需要事务
    // longitude 在前（PostGIS 标准：lon, lat → ST_MakePoint）
    const warehouse = await findWarehouseByPoint(db, Number(address.lng), Number(address.lat));
    if (!warehouse) {
      throw new ConflictException({
        code: 'E-ORDER-001',
        message: 'Delivery address is out of all warehouses coverage',
      });
    }

    // ===== Step 3: 一次性查所有 SKU =====
    const skuIds = input.items.map((i) => i.skuId);
    const skus = await db.sku.findMany({
      where: { id: { in: skuIds }, status: 'ACTIVE' },
      include: { product: true },
    });
    if (skus.length !== skuIds.length) {
      throw new ConflictException({
        code: 'E-ORDER-005',
        message: 'Some SKUs are invalid or inactive',
        details: { requestedCount: skuIds.length, foundCount: skus.length },
      });
    }
    // 任意 product 已下架
    if (skus.some((s: { product: { status: string } }) => s.product.status !== 'ACTIVE')) {
      throw new ConflictException({
        code: 'E-ORDER-005',
        message: 'Some products are inactive',
      });
    }

    // ===== Step 4: 计算金额（整数分） =====
    const qtyMap = new Map(input.items.map((i) => [i.skuId, i.quantity]));

    let itemsSubtotal = 0;
    const orderItemData = skus.map((sku) => {
      const qty = qtyMap.get(sku.id) ?? 0;
      const unitPrice = sku.price;
      const subtotal = unitPrice * qty;
      itemsSubtotal += subtotal;
      return {
        productId: sku.productId,
        skuId: sku.id,
        productName: sku.product.name,
        productImage: sku.product.mainImage,
        skuName: sku.name,
        unitPrice,
        quantity: qty,
        subtotal,
      };
    });

    const deliveryFee = warehouse.deliveryFee;
    const totalAmount = itemsSubtotal + deliveryFee;
    // discountAmount + payableAmount 在事务内计算（W7-ext-G：promo 原子 increment）

    // ===== Step 5: 生成 orderNo（事务前调 Redis，避免事务内 IO） =====
    const warehouseCode = warehouse.code.replace(/^W/, ''); // "W01" → "01"
    const orderNo = await this.orderNoService.nextOrderNo(warehouseCode);

    const initialStatus = getInitialState(input.paymentMethod);

    // ===== Step 6: 事务创建 Order + Items + 扣库存 + Event =====
    try {
      const created = await withTransaction(async (tx: Tx) => {
        // 6.0 应用促销码（W7-ext-G）：校验 + 计算 discount + 原子 increment usedCount
        let discountAmount = 0;
        if (input.promoCode) {
          const applied = await this.promotionService.applyPromotion(
            input.promoCode,
            input.userId,
            itemsSubtotal,
            deliveryFee,
            tx,
          );
          discountAmount = applied.discountAmount;
        }
        const payableAmount = totalAmount - discountAmount;

        // 6.1 创建 Order
        const order = await tx.order.create({
          data: {
            orderNo,
            userId: input.userId,
            warehouseId: warehouse.id,
            status: initialStatus,
            totalAmount,
            deliveryFee,
            discountAmount,
            payableAmount,
            deliveryAddress: {
              name: address.name,
              phone: address.phone,
              detail: address.detail,
              lat: Number(address.lat),
              lng: Number(address.lng),
            },
            remark: input.remark ?? null,
            paymentMethod: input.paymentMethod,
            paymentStatus: 'PENDING',
          },
        });

        // 6.2 批量创建 OrderItem（多语言 JSON 字段强转 InputJsonValue）
        await tx.orderItem.createMany({
          data: orderItemData.map((item) => ({
            orderId: order.id,
            productId: item.productId,
            skuId: item.skuId,
            productName: item.productName as Prisma.InputJsonValue,
            productImage: item.productImage,
            skuName: item.skuName as Prisma.InputJsonValue,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            subtotal: item.subtotal,
          })),
        });

        // 6.3 行锁扣库存（任一失败 throw → 自动回滚）
        for (const item of orderItemData) {
          const ok = await deductStock(tx, warehouse.id, item.skuId, item.quantity, {
            reason: `order ${order.orderNo} created`,
            referenceType: 'ORDER',
            referenceId: order.id,
            operatorId: input.userId,
          });
          if (!ok) {
            // 库存不足，事务自动回滚
            throw new Error(
              `STOCK_NOT_ENOUGH: warehouse ${warehouse.code} sku ${item.skuId} qty ${item.quantity}`,
            );
          }
        }

        // 6.4 写 OrderEvent
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            eventType: 'CREATED',
            fromStatus: null,
            toStatus: initialStatus,
            operatorId: input.userId,
            deviceType: toPrismaDeviceType(input.deviceType),
            perspective: input.perspective ?? null,
            metadata: {
              warehouseCode: warehouse.code,
              itemCount: orderItemData.length,
              paymentMethod: input.paymentMethod,
            } as Prisma.InputJsonValue,
          },
        });

        return order;
      });

      // ===== Step 7: 事务后创建 PaymentIntent =====
      // PaymentIntent 创建失败（如 strategy 抛错）→ 自动取消订单（回滚库存）
      let paymentClientSecret: string | undefined;
      let paymentMockFlag = false;
      try {
        const intent = await this.paymentService.createIntentForOrder({
          orderId: created.id,
          orderNo: created.orderNo,
          amount: created.payableAmount,
          method: created.paymentMethod,
        });
        paymentClientSecret = intent.clientSecret;
        paymentMockFlag = intent.mockFlag;
      } catch (e) {
        logger.error({
          msg: 'PAYMENT_INTENT_CREATE_FAILED',
          orderId: created.id,
          orderNo: created.orderNo,
          error: (e as Error).message,
        });
        // 自动取消订单（释放库存 + 标 CANCELLED）
        await this.cancelOrderInternal(created.id, {
          operatorId: input.userId,
          deviceType: input.deviceType,
          perspective: input.perspective,
          reason: `payment_intent_create_failed: ${(e as Error).message}`,
        });
        throw new ConflictException({
          code: 'E-PAYMENT-004',
          message: 'Failed to create payment intent, order auto-cancelled',
        });
      }

      logger.info({
        msg: 'ORDER_CREATED',
        orderId: created.id,
        orderNo: created.orderNo,
        userId: input.userId,
        warehouseCode: warehouse.code,
        status: created.status,
        payableAmount: created.payableAmount,
        paymentMethod: created.paymentMethod,
        itemCount: orderItemData.length,
      });

      // W3-C：入队超时取消 job（PENDING_* 状态 15 分钟未推进则自动取消）
      // 失败容忍：Redis 不可用时不阻塞下单
      await enqueueOrderTimeout(this.timeoutQueue, created.id, created.status);

      // 下单成功后清空购物车已下单 items（B1 修复）
      // 失败容忍：清购物车失败不阻塞下单（用户可手动清，订单已成功）
      const orderedSkuIds = input.items.map((i) => i.skuId);
      if (this.cartService && orderedSkuIds.length > 0) {
        try {
          await this.cartService.clearOrderedItems(input.userId, orderedSkuIds);
        } catch (e) {
          logger.warn({
            msg: 'CART_CLEAR_AFTER_ORDER_FAILED',
            orderId: created.id,
            userId: input.userId,
            skuIds: orderedSkuIds,
            error: (e as Error).message,
          });
        }
      }

      // 查 OrderItem 完整记录（含 id），与 GET /client/orders/:id 返回结构一致
      const persistedItems = await db.orderItem.findMany({
        where: { orderId: created.id },
        orderBy: { id: 'asc' },
      });

      return {
        id: created.id,
        orderNo: created.orderNo,
        status: created.status,
        warehouseId: created.warehouseId,
        totalAmount: created.totalAmount,
        deliveryFee: created.deliveryFee,
        discountAmount: created.discountAmount,
        payableAmount: created.payableAmount,
        paymentMethod: created.paymentMethod,
        paymentStatus: created.paymentStatus,
        paymentClientSecret,
        paymentMockFlag,
        items: persistedItems.map((i) => ({
          id: i.id,
          productId: i.productId,
          skuId: i.skuId,
          productName: i.productName as Record<string, string>,
          productImage: i.productImage,
          skuName: i.skuName as Record<string, string>,
          unitPrice: i.unitPrice,
          quantity: i.quantity,
          subtotal: i.subtotal,
        })),
        createdAt: created.createdAt.toISOString(),
      };
    } catch (e) {
      // 库存不足错误 → E-ORDER-002
      if ((e as Error).message.startsWith('STOCK_NOT_ENOUGH')) {
        throw new ConflictException({
          code: 'E-ORDER-002',
          message: 'Some items are out of stock',
        });
      }
      throw e;
    }
  }

  /**
   * 客户端取消订单
   */
  async cancelOrder(
    orderId: string,
    userId: string,
    reason: string,
    eventCtx: OrderEventContext,
  ): Promise<void> {
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) {
      throw new NotFoundException({
        code: 'E-ORDER-004',
        message: 'Order not found',
      });
    }

    if (!isUserCancellable(order.status)) {
      throw new ConflictException({
        code: 'E-ORDER-003',
        message: `Order status ${order.status} cannot be cancelled by user (contact customer service)`,
      });
    }

    await this.cancelOrderInternal(orderId, {
      operatorId: userId,
      deviceType: eventCtx.deviceType,
      perspective: eventCtx.perspective,
      reason,
    });

    // 取消超时 job（避免后续 BullMQ job 触发时重复取消）
    await cancelOrderTimeout(this.timeoutQueue, orderId);
  }

  /**
   * 取消待支付/待确认订单（BullMQ 超时 job 触发）
   *
   * 幂等：订单若已推进到 CONFIRMED 之后的状态则跳过
   *
   * S3 修复：透传 deviceType='admin_web' + perspective='system' 给 cancelOrderInternal，
   * 让 OrderEvent 记录能区分"系统自动取消"和"用户手动取消"
   *
   * 用法：
   *   - OrderTimeoutProcessor.process() 调用
   *   - 未来 admin 拒单接口（W3+）也可复用
   */
  async cancelIfPending(
    orderId: string,
    ctx: { reason: string; operatorId?: string },
  ): Promise<{ cancelled: boolean; fromStatus: OrderStatusValue | null }> {
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) {
      logger.warn({
        msg: 'ORDER_TIMEOUT_ORDER_NOT_FOUND',
        orderId,
      });
      return { cancelled: false, fromStatus: null };
    }
    // 已推进到 CONFIRMED 及之后状态 → 跳过（不再取消）
    if (
      order.status !== 'PENDING_PAYMENT' &&
      order.status !== 'PENDING_CONFIRM'
    ) {
      logger.info({
        msg: 'ORDER_TIMEOUT_SKIP',
        orderId,
        status: order.status,
      });
      return { cancelled: false, fromStatus: order.status };
    }

    await this.cancelOrderInternal(orderId, {
      operatorId: ctx.operatorId,
      deviceType: 'system', // V2-S5 修复：用 'system' 表达 BullMQ 自动操作（不再混淆 admin_web）
      perspective: 'system',
      reason: ctx.reason,
    });

    return { cancelled: true, fromStatus: order.status };
  }

  /**
   * 内部取消订单（业务自动取消 + 用户主动取消共用）
   *
   * 不校验状态合法性（调用方负责），直接：
   *   - 释放库存（releaseStock 每个 OrderItem）
   *   - Order.status=CANCELLED + cancelledAt + cancelReason
   *   - 写 OrderEvent(CANCELLED)
   *
   * 预付场景已支付的订单取消：W5 接入 RefundService 触发退款（这里留 TODO）
   */
  async cancelOrderInternal(
    orderId: string,
    ctx: {
      operatorId?: string;
      deviceType?: ContractDeviceType;
      perspective?: string;
      reason: string;
    },
  ): Promise<void> {
    // 事务外查 order（broadcast 用，事务内再查一次校验一致性）
    const orderForBroadcast = await db.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });

    await withTransaction(async (tx: Tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) {
        // P1-3 修复：raw Error → 业务错误码
        throw new NotFoundException({
          code: 'E-ORDER-004',
          message: `Order not found: ${orderId}`,
        });
      }
      if (order.status === 'CANCELLED' || order.status === 'COMPLETED') {
        // 幂等：已终态直接 return（避免重复取消报错）
        return;
      }

      // 释放库存（无论之前是什么状态，已扣的库存都要回滚）
      for (const item of order.items) {
        await releaseStock(tx, order.warehouseId, item.skuId, item.quantity, 'RELEASE', {
          reason: ctx.reason,
          referenceType: 'ORDER',
          referenceId: order.id,
          operatorId: ctx.operatorId,
        });
      }

      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: ctx.reason,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId,
          eventType: 'CANCELLED',
          fromStatus: order.status,
          toStatus: 'CANCELLED',
          operatorId: ctx.operatorId ?? null,
          deviceType: toPrismaDeviceType(ctx.deviceType),
          perspective: ctx.perspective ?? null,
          metadata: { reason: ctx.reason } as Prisma.InputJsonValue,
        },
      });

      logger.info({
        msg: 'ORDER_CANCELLED',
        orderId,
        orderNo: order.orderNo,
        fromStatus: order.status,
        reason: ctx.reason,
      });
      void updated;
    });

    // W4-REVIEW P0-3 修复：取消订单后广播业务事件
    try {
      this.realtime?.broadcastOrderStatusChange(orderId, {
        fromStatus: orderForBroadcast?.status ?? 'UNKNOWN',
        toStatus: 'CANCELLED',
        operatorId: ctx.operatorId,
        reason: ctx.reason,
      });
    } catch (e) {
      logger.warn({
        msg: 'WS_BROADCAST_FAILED',
        orderId,
        event: 'order:status-changed',
        error: (e as Error).message,
      });
    }
  }

  /**
   * 支付成功回调（PaymentService 在 mock-callback / 真实回调时调）
   *
   * 流程：
   *   - 状态机：PENDING_PAYMENT → CONFIRMED（assertCanTransition）
   *   - 写 Order.paidAt + paymentStatus=PAID
   *   - 写 OrderEvent(PAYMENT_SUCCESS)
   */
  async markPaid(orderId: string, eventCtx: OrderEventContext): Promise<void> {
    // 事务外查 order（broadcast/notify 用），事务内再查一次校验状态一致性
    const orderForNotify = await db.order.findUnique({
      where: { id: orderId },
      select: { userId: true, orderNo: true, status: true, paymentStatus: true },
    });

    await withTransaction(async (tx: Tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) {
        // P1-3 修复：raw Error → 业务错误码
        throw new NotFoundException({
          code: 'E-ORDER-004',
          message: `Order not found: ${orderId}`,
        });
      }
      // 已付幂等（重复回调直接 return）
      if (order.paymentStatus === 'PAID') {
        return;
      }
      // 状态机校验：仅 PENDING_PAYMENT 可走支付成功路径
      if (order.status !== 'PENDING_PAYMENT') {
        throw new ConflictException({
          code: 'E-ORDER-003',
          message: `Order status ${order.status} cannot be marked as paid`,
        });
      }

      assertCanTransition(order.status, 'CONFIRMED');

      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          paymentStatus: 'PAID',
          paidAt: new Date(),
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId,
          eventType: 'PAYMENT_SUCCESS',
          fromStatus: order.status,
          toStatus: 'CONFIRMED',
          operatorId: eventCtx.operatorId ?? null,
          deviceType: toPrismaDeviceType(eventCtx.deviceType),
          perspective: eventCtx.perspective ?? null,
          metadata: (eventCtx.metadata as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        },
      });
    });

    // 事务后取消超时 job（避免 job 触发时再尝试取消已 CONFIRMED 的订单）
    await cancelOrderTimeout(this.timeoutQueue, orderId);

    // 订单 CONFIRMED → 自动创建 DeliveryTask（骑手可抢单）
    // 失败容忍：dispatch 创建失败不阻塞 markPaid（admin 可手动补 task）
    if (this.dispatchService) {
      try {
        await this.dispatchService.createTaskForOrder(orderId);
      } catch (e) {
        logger.error({
          msg: 'DISPATCH_TASK_CREATE_FAILED',
          orderId,
          error: (e as Error).message,
        });
      }
    }

    // W4-REVIEW P0-3 修复：串接 RealtimeGateway 业务事件 + NotifyFactory 通知
    // 失败容忍：WS/通知失败不阻塞订单流程
    try {
      this.realtime?.broadcastOrderStatusChange(orderId, {
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'CONFIRMED',
        operatorId: eventCtx.operatorId,
      });
    } catch (e) {
      logger.warn({
        msg: 'WS_BROADCAST_FAILED',
        orderId,
        event: 'order:status-changed',
        error: (e as Error).message,
      });
    }

    if (this.notifyFactory && orderForNotify) {
      try {
        await this.notifyFactory.sendMulti(
          {
            userId: orderForNotify.userId,
            type: 'PAYMENT_SUCCESS',
            title: {
              en: 'Order Confirmed',
              zh: '订单已确认',
              id: 'Pesanan Dikonfirmasi',
              pt: 'Pedido Confirmado',
            },
            body: {
              en: `Your order ${orderForNotify.orderNo} has been confirmed and is being prepared.`,
              zh: `您的订单 ${orderForNotify.orderNo} 已确认，正在备货。`,
              id: `Pesanan Anda ${orderForNotify.orderNo} telah dikonfirmasi.`,
              pt: `Seu pedido ${orderForNotify.orderNo} foi confirmado.`,
            },
          },
          ['EMAIL', 'SMS'],
        );
      } catch (e) {
        logger.warn({
          msg: 'NOTIFY_SEND_FAILED',
          orderId,
          type: 'PAYMENT_SUCCESS',
          error: (e as Error).message,
        });
      }
    }
  }

  /**
   * Admin 确认订单（COD 订单：PENDING_CONFIRM → CONFIRMED + 创建 dispatch 任务）
   *
   * W6 审查报告 P1 修复：COD 订单下单后卡在 PENDING_CONFIRM，
   * 仓库管理员需要通过 API 确认订单才能进入配送流程。
   */
  async adminConfirmOrder(
    orderId: string,
    eventCtx: OrderEventContext,
  ): Promise<void> {
    const orderForBroadcast = await db.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });

    await withTransaction(async (tx: Tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) {
        throw new NotFoundException({
          code: 'E-ORDER-004',
          message: `Order not found: ${orderId}`,
        });
      }
      // 幂等：已确认直接 return
      if (order.status !== 'PENDING_CONFIRM') {
        throw new ConflictException({
          code: 'E-ORDER-003',
          message: `Order status ${order.status} cannot be confirmed (must be PENDING_CONFIRM)`,
        });
      }

      assertCanTransition(order.status, 'CONFIRMED');

      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId,
          eventType: 'CONFIRMED',
          fromStatus: order.status,
          toStatus: 'CONFIRMED',
          operatorId: eventCtx.operatorId ?? null,
          deviceType: toPrismaDeviceType(eventCtx.deviceType),
          perspective: eventCtx.perspective ?? null,
          metadata: (eventCtx.metadata as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        },
      });
    });

    // 取消超时 job
    await cancelOrderTimeout(this.timeoutQueue, orderId);

    // CONFIRMED → 自动创建 DeliveryTask（与 markPaid 一致）
    if (this.dispatchService) {
      try {
        await this.dispatchService.createTaskForOrder(orderId);
      } catch (e) {
        logger.error({
          msg: 'DISPATCH_TASK_CREATE_FAILED',
          orderId,
          error: (e as Error).message,
        });
      }
    }

    // WS 广播
    try {
      this.realtime?.broadcastOrderStatusChange(orderId, {
        fromStatus: orderForBroadcast?.status ?? 'PENDING_CONFIRM',
        toStatus: 'CONFIRMED',
        operatorId: eventCtx.operatorId,
      });
    } catch (e) {
      logger.warn({
        msg: 'WS_BROADCAST_FAILED',
        orderId,
        event: 'order:status-changed',
        error: (e as Error).message,
      });
    }

    logger.info({
      msg: 'ORDER_ADMIN_CONFIRMED',
      orderId,
      operatorId: eventCtx.operatorId,
    });
  }

  /**
   * Admin 拣货完成（CONFIRMED → PICKED）
   *
   * W7 补功能：仓库拣货完成后推进订单状态，骑手可取货出发。
   */
  async adminPickOrder(
    orderId: string,
    eventCtx: OrderEventContext,
  ): Promise<void> {
    const orderForBroadcast = await db.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });

    await withTransaction(async (tx: Tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) {
        throw new NotFoundException({
          code: 'E-ORDER-004',
          message: `Order not found: ${orderId}`,
        });
      }
      // 幂等：已拣货直接 return
      if (order.status !== 'CONFIRMED') {
        throw new ConflictException({
          code: 'E-ORDER-003',
          message: `Order status ${order.status} cannot be picked (must be CONFIRMED)`,
        });
      }

      assertCanTransition(order.status, 'PICKED');

      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'PICKED',
          pickedAt: new Date(),
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId,
          eventType: 'PICKED',
          fromStatus: order.status,
          toStatus: 'PICKED',
          operatorId: eventCtx.operatorId ?? null,
          deviceType: toPrismaDeviceType(eventCtx.deviceType),
          perspective: eventCtx.perspective ?? null,
          metadata: (eventCtx.metadata as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        },
      });
    });

    // WS 广播
    try {
      this.realtime?.broadcastOrderStatusChange(orderId, {
        fromStatus: orderForBroadcast?.status ?? 'CONFIRMED',
        toStatus: 'PICKED',
        operatorId: eventCtx.operatorId,
      });
    } catch (e) {
      logger.warn({
        msg: 'WS_BROADCAST_FAILED',
        orderId,
        event: 'order:status-changed',
        error: (e as Error).message,
      });
    }

    logger.info({
      msg: 'ORDER_ADMIN_PICKED',
      orderId,
      operatorId: eventCtx.operatorId,
    });
  }

  /**
   * Admin 编辑订单（W7-ext-C）
   *
   * MVP 仅允许修改 remark（订单备注）：
   * - warehouseId 改动会破坏 orderNo 编码（含 warehouseCode），不可改
   * - deliveryAddress 是下单时快照，改地址应重新下单
   * - 已 CANCELLED/COMPLETED 的订单不可编辑
   */
  async adminUpdateOrder(
    orderId: string,
    input: { remark?: string | null },
    eventCtx: OrderEventContext,
  ): Promise<OrderWithRelations> {
    await withTransaction(async (tx: Tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) {
        throw new NotFoundException({
          code: 'E-ORDER-004',
          message: `Order not found: ${orderId}`,
        });
      }
      if (order.status === 'CANCELLED' || order.status === 'COMPLETED') {
        throw new ConflictException({
          code: 'E-ORDER-003',
          message: `Order status ${order.status} cannot be edited`,
        });
      }

      const data: { remark?: string | null } = {};
      if (input.remark !== undefined) {
        data.remark = input.remark === null || input.remark.trim() === '' ? null : input.remark.trim().slice(0, 200);
      }

      if (Object.keys(data).length === 0) {
        return;
      }

      await tx.order.update({ where: { id: orderId }, data });
      // 备注编辑不写 OrderEvent（eventType 枚举无 UPDATED，且不影响状态机）
    });

    logger.info({
      msg: 'ORDER_ADMIN_UPDATED',
      orderId,
      operatorId: eventCtx.operatorId,
      fields: Object.keys(input),
    });

    return this.adminGetOrderDetail(orderId);
  }

  /**
   * 查询订单详情（含 items + events）
   */
  async getOrderDetail(orderId: string, userId: string): Promise<OrderWithRelations> {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        items: { orderBy: { id: 'asc' } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order || order.userId !== userId) {
      throw new NotFoundException({
        code: 'E-ORDER-004',
        message: 'Order not found',
      });
    }
    return this.toOrderWithRelations(order);
  }

  /**
   * 查询用户订单列表（游标分页）
   */
  async listUserOrders(
    userId: string,
    options: { status?: OrderStatusValue; cursor?: string; limit?: number },
  ): Promise<{ items: OrderWithRelations[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = Math.min(options.limit ?? 20, 50);
    const where: Record<string, unknown> = { userId };
    if (options.status) {
      where.status = options.status;
    }

    const orders = await db.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: {
        items: { orderBy: { id: 'asc' } },
        events: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    const hasMore = orders.length > limit;
    const items = hasMore ? orders.slice(0, limit) : orders;

    return {
      items: items.map((o: Record<string, unknown>) => this.toOrderWithRelations(o)),
      nextCursor: hasMore ? (items[items.length - 1] as { id: string }).id : null,
      hasMore,
    };
  }

  /**
   * 查询全部订单（admin 视角，跨用户）
   *
   * W4 新增：admin-web /orders 页面需要
   *
   * 支持筛选：status / userId / warehouseId / orderNo / 时间范围
   */
  async listAllOrders(
    options: {
      status?: OrderStatusValue;
      userId?: string;
      warehouseId?: string;
      orderNo?: string;
      cursor?: string;
      limit?: number;
    },
  ): Promise<{ items: OrderWithRelations[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = Math.min(options.limit ?? 20, 100);
    const where: Record<string, unknown> = {};
    if (options.status) where.status = options.status;
    if (options.userId) where.userId = options.userId;
    if (options.warehouseId) where.warehouseId = options.warehouseId;
    if (options.orderNo) where.orderNo = { contains: options.orderNo, mode: 'insensitive' };

    const orders = await db.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: {
        items: { orderBy: { id: 'asc' } },
        events: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    const hasMore = orders.length > limit;
    const items = hasMore ? orders.slice(0, limit) : orders;

    return {
      items: items.map((o: Record<string, unknown>) => this.toOrderWithRelations(o)),
      nextCursor: hasMore ? (items[items.length - 1] as { id: string }).id : null,
      hasMore,
    };
  }

  /** admin 取订单详情（不校验 userId 归属） */
  async adminGetOrderDetail(orderId: string): Promise<OrderWithRelations> {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        items: { orderBy: { id: 'asc' } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'E-ORDER-004',
        message: `Order not found: ${orderId}`,
      });
    }
    return this.toOrderWithRelations(order);
  }

  /** Prisma Order → API DTO（DateTime → ISO 字符串） */
  private toOrderWithRelations(order: unknown): OrderWithRelations {
    const o = order as {
      id: string;
      orderNo: string;
      userId: string;
      warehouseId: string;
      status: OrderStatusValue;
      totalAmount: number;
      deliveryFee: number;
      discountAmount: number;
      payableAmount: number;
      deliveryAddress: unknown;
      remark: string | null;
      riderId: string | null;
      paymentMethod: PaymentMethodValue;
      paymentStatus: string;
      paidAt: Date | null;
      createdAt: Date;
      confirmedAt: Date | null;
      pickedAt: Date | null;
      deliveringAt: Date | null;
      deliveredAt: Date | null;
      completedAt: Date | null;
      cancelledAt: Date | null;
      cancelReason: string | null;
      items: Array<Record<string, unknown>>;
      events: Array<Record<string, unknown>>;
    };
    const toIso = (d: Date | null) => (d ? d.toISOString() : null);
    return {
      id: o.id,
      orderNo: o.orderNo,
      userId: o.userId,
      warehouseId: o.warehouseId,
      status: o.status,
      totalAmount: o.totalAmount,
      deliveryFee: o.deliveryFee,
      discountAmount: o.discountAmount,
      payableAmount: o.payableAmount,
      deliveryAddress: o.deliveryAddress,
      remark: o.remark,
      riderId: o.riderId,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      paidAt: toIso(o.paidAt),
      createdAt: o.createdAt.toISOString(),
      confirmedAt: toIso(o.confirmedAt),
      pickedAt: toIso(o.pickedAt),
      deliveringAt: toIso(o.deliveringAt),
      deliveredAt: toIso(o.deliveredAt),
      completedAt: toIso(o.completedAt),
      cancelledAt: toIso(o.cancelledAt),
      cancelReason: o.cancelReason,
      items: o.items.map((i) => ({
        id: i.id as string,
        productId: i.productId as string,
        skuId: i.skuId as string,
        productName: i.productName,
        productImage: i.productImage as string,
        skuName: i.skuName,
        unitPrice: i.unitPrice as number,
        quantity: i.quantity as number,
        subtotal: i.subtotal as number,
      })),
      events: o.events.map((e) => ({
        id: e.id as string,
        eventType: e.eventType as string,
        fromStatus: (e.fromStatus as OrderStatusValue) ?? null,
        toStatus: e.toStatus as OrderStatusValue,
        operatorId: (e.operatorId as string) ?? null,
        metadata: e.metadata,
        createdAt: (e.createdAt as Date).toISOString(),
      })),
    };
  }
}
