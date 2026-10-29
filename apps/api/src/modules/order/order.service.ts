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
import { Injectable, Inject, NotFoundException, ConflictException, BadRequestException, Optional } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db, withTransaction, deductStock, releaseStock, findWarehouseByPoint, incrementSalesCountForOrder, isWarehouseOpen, nextOpenAt } from '../../shared/db';
import type { Tx } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { OrderNoService } from './order-no.service';
import { getInitialState, assertCanTransition, isUserCancellable, isTerminalStatus } from './order-status.machine';
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
import { OrderStatus } from '@meimart/api-contract';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ORDER_TIMEOUT_QUEUE } from '../../shared/queue';
import { PricingService } from '../pricing/pricing.service';
import { resolveOrderEffectiveRate, buildOrderRateFields } from '../rate/rate.service';
import { isPaymentMethodOrderable } from '../payment/payment-methods.config';
import { OutOfStockRefundService } from './out-of-stock-refund.service';
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
  /**
   * 骑手详情嵌套（P10 订单详情骑手联系卡 / P11 物流追踪 CourierCard 数据源）。
   * 仅详情接口（getOrderDetail / adminGetOrderDetail）include rider 时有值；
   * 列表接口（listUserOrders / listAllOrders）未 include -> null。
   * rating 为 Prisma Decimal(3,2) 序列化的 string，前端 parseFloat 后展示。
   * avatarUrl 从 RiderProfile.user.avatarUrl 平铺（零迁移复用 User 关系）。
   */
  rider?: {
    id: string;
    riderName: string;
    phone: string;
    rating: string;
    totalDeliveries: number;
    vehicleType: string;
    avatarUrl: string | null;
  } | null;
  paymentMethod: PaymentMethodValue;
  paymentStatus: string;
  paidAt: string | null;
  /** 批A 汇率快照（万分位）：人民币通道订单下单锁定值；非人民币通道 null */
  exchangeRate: number | null;
  /** 批A 人民币估算金额（分）= payableAmount × exchangeRate / 10000；非人民币通道 null */
  estimatedCnyAmount: number | null;
  createdAt: string;
  /** 预约单开门时间 ISO（保证金批A P2-1，2026-09-10）；即时单 null。契约 Order.scheduledFor 同名 */
  scheduledFor: string | null;
  confirmedAt: string | null;
  pickedAt: string | null;
  deliveringAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /**
   * P27 批B1（2026-10-13）：软删标记 ISO。client 详情恒 null（getOrderDetail 过滤软删行）；
   * admin 详情非 null = 「用户已删除」展示依据。
   */
  deletedAt: string | null;
  /** 替换品批1（D9/D13）：订单级替换策略 + SPECIFY 白名单透出 */
  replacementPolicy: string;
  allowedReplacementSkuIds: string[] | null;
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
    /** 当前库存（全仓库聚合，B12）。undefined=无库存信息 */
    stock?: number;
    /** 替换品批1（D4）：确认态，null=未触发确认 */
    suggestionStatus: string | null;
    /** 用户决策时间 ISO（ACCEPTED/DECLINED 落点） */
    suggestionDecidedAt: string | null;
    /** 替换品批1 P2-3（2026-10-29）：建议目标摘要（join 同单目标行；null=无建议） */
    suggestionItem: {
      name: unknown;
      image: string | null;
      unitPrice: number;
    } | null;
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
  /** 应用的促销（W7-ext-G-fix2）：null = 未用码 */
  promotion: {
    promotionId: string;
    code: string;
    discountAmount: number;
  } | null;
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
    @Inject(PricingService) private readonly pricingService: PricingService,
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
    // 批A（2026-09-09）：事件通知挂点（站内信 + PUSH，全链失败容忍）
    @Inject('NotificationEventServiceToken')
    private readonly notificationEvents: {
      notify: (input: {
        event: string;
        userId: string;
        type: string;
        data?: Record<string, unknown>;
        params?: Record<string, string>;
      }) => Promise<void>;
    } | null,
    // 替换品批1（2026-10-29 D5/D6）：决策端点复用 system 退款引擎（差额/拒绝全额），
    // @Optional 兜底单测直 new 不传（out-of-stock.service 同款）
    @Optional() @Inject(OutOfStockRefundService)
    private readonly oosRefundEngine?: OutOfStockRefundService | null,
  ) {}

  /**
   * 创建订单（同步事务）
   *
   * 业务异常：
   *   - E-PAYMENT-011 支付渠道不可用（占位渠道 available=false，批B R2）
   *   - E-ORDER-001 地址不在配送范围（含地址不存在 / 无仓库覆盖）
   *   - E-ORDER-002 库存不足
   *   - E-ORDER-005 SKU 无效或已下架
   *   - E-COMMON-002 内部错误（事务异常）
   */
  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    // ===== Step 0: 支付渠道可用性校验（批B R2🔴，微信支付预留 2026-09-08，方案V2 §3.2 第 6 条）=====
    // 占位渠道（WECHAT_GLOBAL/ALIPAY_CN/LOCAL_PSP，available=false）或不在 config 的渠道 → 400 拒绝。
    // 校验在 getInitialState 分流前（也先于任何 DB 查询），避免占位渠道进状态机产生死单。
    // 契约 zod 已挡未知枚举值，此处防御 config 漏配 / 直调 service。
    if (!isPaymentMethodOrderable(input.paymentMethod)) {
      throw new BadRequestException({
        code: 'E-PAYMENT-011',
        message: `Payment method ${input.paymentMethod} is not available yet`,
      });
    }

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

    // ===== Step 2.5: 营业时间判断（保证金批A T5-a/b/c，2026-09-10）=====
    // 单仓匹配（LIMIT 1）无候选集合：匹配仓打烊 → 该单走预约（scheduledFor=下次开门时间），
    // 不换仓不拒单（超市模式 T5-b）；未打烊 → 即时单（scheduledFor=null）。
    // 防御解析在 isWarehouseOpen 内：无配置=24h 营业；close<open = 合法跨午夜窗口
    // （环绕零点判定，2026-10-09 修复）；close===open 视为异常数据打烊。
    const operatingHours = (warehouse as { operatingHours?: unknown }).operatingHours ?? null;
    const warehouseOpen = isWarehouseOpen(operatingHours as Record<string, unknown> | null);
    const scheduledFor = warehouseOpen ? null : nextOpenAt(operatingHours as Record<string, unknown> | null);
    if (!warehouseOpen) {
      logger.info({
        msg: 'ORDER_CREATED_AS_RESERVATION',
        warehouseCode: warehouse.code,
        scheduledFor: scheduledFor?.toISOString() ?? null,
      });
    }

    // ===== Step 3: 一次性查所有 SKU =====
    // 批2 性能清理（20261012）：同 skuId 多行（购物车合并场景）先合并数量——
    // 原实现 skuIds 含重复会导致 findMany 返回数 < 请求行数误抛 E-ORDER-005；
    // 对照 listOrders skuId 去重 Set 先例（同文件）。qtyMap 语义同步升级为「合并后总量」。
    const qtyMap = new Map<string, number>();
    for (const item of input.items) {
      qtyMap.set(item.skuId, (qtyMap.get(item.skuId) ?? 0) + item.quantity);
    }
    const skuIds = [...qtyMap.keys()];
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

    // ===== Step 3.5: SPECIFY 白名单 SKU 校验（替换品批1 D13）=====
    // 契约 superRefine 已保证 SPECIFY⇒非空 / 非 SPECIFY⇒禁带；此处防御 service 直调 +
    // 校验白名单 SKU 全部合法且属于本单（允许本单主购项也进白名单，无额外约束）。
    if (input.replacementPolicy === 'SPECIFY' && input.allowedReplacementSkuIds) {
      const whitelistIds = [...new Set(input.allowedReplacementSkuIds)];
      const whitelistSkus = await db.sku.findMany({
        where: { id: { in: whitelistIds }, status: 'ACTIVE' },
        select: { id: true },
      });
      if (whitelistSkus.length !== whitelistIds.length) {
        throw new ConflictException({
          code: 'E-ORDER-010',
          message: 'Some allowedReplacementSkuIds are invalid or inactive',
        });
      }
    }

    // ===== Step 4: 计算金额（整数分） =====
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

    // ===== Step 4.5: 计算配送费（距离计费，2026-08-27 批次1） =====
    // 公式：deliveryFee = baseFee + max(0, distanceKm - freeKm) × perKmFee
    // 走 PostGIS ST_DistanceSphere（pricingService.calcDeliveryFee 内部）。
    // address.lat/lng 非空已在 Step 1 守卫，此处必有坐标 → 调用计费 + 写快照。
    // 无 centerPoint（异常仓库）时 pricingService 退化为 baseFee + distanceKm=null，仍可下单。
    const feeResult = await this.pricingService.calcDeliveryFee(
      warehouse.id,
      Number(address.lat),
      Number(address.lng),
    );
    const deliveryFee = feeResult.deliveryFee;
    const deliveryFeeBreakdown: {
      baseFee: number;
      distanceFee: number;
      distanceKm: number | null;
      perKmFee: number;
      freeKm: number;
    } = {
      baseFee: feeResult.baseFee,
      distanceFee: feeResult.distanceFee,
      distanceKm: feeResult.distanceKm,
      perKmFee: feeResult.perKmFee,
      freeKm: feeResult.freeKm,
    };
    const totalAmount = itemsSubtotal + deliveryFee;
    // discountAmount + payableAmount 在事务内计算（W7-ext-G：promo 原子 increment）

    // ===== Step 5: 生成 orderNo（事务前调 Redis，避免事务内 IO） =====
    const warehouseCode = warehouse.code.replace(/^W/, ''); // "W01" → "01"
    const orderNo = await this.orderNoService.nextOrderNo(warehouseCode);

    const initialStatus = getInitialState(input.paymentMethod);

    // ===== Step 5.5: 汇率快照（批A 汇率体系，微信支付预留）：人民币通道取当日汇率 =====
    // 事务外 IO（同 Step 5 orderNo 模式）；非人民币通道返回 null 且不查库（本地用户纯 USD 零影响）。
    // WECHAT_GLOBAL/ALIPAY_CN 枚举批B 补位，钩子按字符串集合判定，批B 落地零改动。
    const cnyEffective = await resolveOrderEffectiveRate(input.paymentMethod);

    // ===== Step 6: 事务创建 Order + Items + 扣库存 + Event =====
    try {
      const created = await withTransaction(async (tx: Tx) => {
        // 6.0 应用优惠券（P1 领券体系）：校验 UserCoupon + 计算 discount + 标 USED
        //     applyCoupon 不写 orderId（order.id 此刻不存在），6.1.1 回填 UserCoupon.orderId
        let discountAmount = 0;
        let appliedCoupon:
          | {
              userCouponId: string;
              promotionId: string;
              code: string;
              type: string;
              discountAmount: number;
            }
          | null = null;
        if (input.couponId) {
          appliedCoupon = await this.promotionService.applyCoupon(
            input.couponId,
            input.userId,
            itemsSubtotal,
            deliveryFee,
            tx,
          );
          discountAmount = appliedCoupon.discountAmount;
        }
        const payableAmount = totalAmount - discountAmount;

        // 汇率快照字段（批A）：人民币通道锁当日汇率，estimatedCnyAmount = payableAmount × rate / 10000
        const rateFields = buildOrderRateFields(payableAmount, cnyEffective);

        // 6.1 创建 Order
        const order = await tx.order.create({
          data: {
            orderNo,
            userId: input.userId,
            warehouseId: warehouse.id,
            status: initialStatus,
            totalAmount,
            deliveryFee,
            deliveryFeeBreakdown,
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
            exchangeRate: rateFields.exchangeRate,
            estimatedCnyAmount: rateFields.estimatedCnyAmount,
            // 预约单承载（T5-c）：null=即时单；打烊仓=下次开门时间
            scheduledFor,
            // 替换品批1（D9/D13）：三选一策略 + SPECIFY 白名单持久化（缺省 ALLOW）
            replacementPolicy: input.replacementPolicy ?? 'ALLOW',
            allowedReplacementSkuIds:
              input.replacementPolicy === 'SPECIFY' ? input.allowedReplacementSkuIds ?? [] : Prisma.JsonNull,
          },
        });

        // 6.1.1 用券关联回填（P1 领券体系）：
        //       a) UserCoupon.orderId 关联当前订单（applyCoupon 标 USED 时未写 orderId）
        //       b) OrderPromotion 快照（冗余 code + discountAmount + userCouponId，防模板改名/删除后无法追溯）
        if (appliedCoupon) {
          await tx.userCoupon.update({
            where: { id: appliedCoupon.userCouponId },
            data: { orderId: order.id },
          });
          await tx.orderPromotion.create({
            data: {
              orderId: order.id,
              promotionId: appliedCoupon.promotionId,
              code: appliedCoupon.code,
              discountAmount: appliedCoupon.discountAmount,
              userCouponId: appliedCoupon.userCouponId,
            },
          });
        }

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

        // 6.4.1 地址使用追踪（20261018）：下单成功即无条件回写地址最近使用时间
        //       单分支——后端下单仅支持 addressId，无「手动输入」信号可区分；
        //       事务内简单 update，失败即整体回滚（可接受语义，任务书口径）；
        //       幂等无害：同一地址连下多单，lastUsedAt 取最后值
        await tx.address.update({
          where: { id: address.id },
          data: { lastUsedAt: new Date() },
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
        // 预约单标注（T5-c）：acceptingReservation=true 时前端展示"明早 {nextOpenAt} 可配送"
        acceptingReservation: scheduledFor !== null,
        scheduledFor: created.scheduledFor ? created.scheduledFor.toISOString() : null,
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
  /**
   * 订单归属断言辅助（payment.controller getIntent/uploadReceipt 归属校验用，P1-2）
   *
   * 只查 userId 最小字段；不存在返回 null，由调用方统一按 E-ORDER-004 处理（防枚举）
   */
  async getOrderForOwnership(orderId: string): Promise<{ userId: string } | null> {
    return db.order.findUnique({
      where: { id: orderId },
      select: { userId: true },
    });
  }

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
    // 预约单超时豁免（保证金批A T5-e，2026-09-10）：预约单（scheduledFor 非空）正是停留
    // PENDING_CONFIRM 等仓库开门，15min 超时 job 不能杀掉它——开门后进 CONFIRMED 正常流转。
    if (order.scheduledFor !== null && order.scheduledFor !== undefined) {
      logger.info({
        msg: 'ORDER_TIMEOUT_SKIP_RESERVATION',
        orderId,
        scheduledFor: order.scheduledFor.toISOString(),
      });
      return { cancelled: false, fromStatus: order.status };
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
   *
   * P1-6（方案v2-后端资金越权并发修复 20261011）：读后判断幂等存在并发窗口——
   * 两笔并发取消都可能读到非终态快照、都释放库存。改 updateMany WHERE status
   * 条件守卫（同文件 markPaid P2-1 先例 / 方案 :758/:883 先例）：count=0 说明
   * 并发赢家已翻 CANCELLED/COMPLETED → 直接幂等 return，不再重复释放库存。
   *
   * ⚠️ P3-1（审查 20261012）互引锚点：本方法与 refund.service.ts cancelOrderInTx 是
   * 刻意保留的平行实现（后者接收外部 tx 供退款同事务收口）——两版逻辑必须保持同构，
   * 任何一侧加列/改口径时另一侧同步改。
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
      select: { status: true, userId: true, orderNo: true },
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

      // P1-6：WHERE status 条件守卫（乐观锁翻转）——只有一笔并发取消能把非终态翻成
      // CANCELLED；输家 count=0 幂等 return，不重复释放库存/写事件/关任务
      const flipped = await tx.order.updateMany({
        where: {
          id: orderId,
          status: { notIn: ['CANCELLED', 'COMPLETED'] },
        },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: ctx.reason,
        },
      });
      if (flipped.count === 0) {
        logger.info({
          msg: 'ORDER_CANCELLED_CONCURRENT_LOSER',
          orderId,
          reason: ctx.reason,
        });
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

      // 联动关闭配送任务（2026-08-20）：订单取消时未接单（PENDING_ASSIGN）/已接单（ASSIGNED）的
      // 任务一并置 FAILED，否则任务永远挂在抢单大厅（实测 49 条 CANCELLED 订单的死任务堆积）。
      // 对齐 dispatch.service cancelTask 范式（置 FAILED + 清 order.riderId）；PICKED_UP 之后的
      // 任务不关（货已在骑手手上，走 dispatch reportIssue 流程），仅清抢单大厅可见性。
      const cancelledTasks = await tx.deliveryTask.updateMany({
        where: { orderId, status: { in: ['PENDING_ASSIGN', 'ASSIGNED'] } },
        data: { status: 'FAILED' },
      });
      if (cancelledTasks.count > 0 && order.riderId) {
        await tx.order.update({
          where: { id: orderId },
          data: { riderId: null },
        });
      }
      if (cancelledTasks.count > 0) {
        logger.info({
          msg: 'ORDER_CANCELLED_TASKS_CLOSED',
          orderId,
          closedTasks: cancelledTasks.count,
        });
      }

      logger.info({
        msg: 'ORDER_CANCELLED',
        orderId,
        orderNo: order.orderNo,
        fromStatus: order.status,
        reason: ctx.reason,
      });
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

    // 批A A4 挂点 2：订单取消 → 站内信 + PUSH（CUSTOMER, ORDER_UPDATE，data.orderId+reason）
    // 失败容忍在 NotificationEventService 内部；注入为 null 时跳过（单测兼容）
    if (this.notificationEvents && orderForBroadcast) {
      await this.notificationEvents.notify({
        event: 'orderCancelled',
        userId: orderForBroadcast.userId,
        type: 'ORDER_UPDATE',
        data: { orderId, orderNo: orderForBroadcast.orderNo, reason: ctx.reason },
        params: { orderNo: orderForBroadcast.orderNo, reason: ctx.reason },
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
      // 核心逻辑抽到 markPaidTx（供 admin-payment confirm-receipt 编排复用，避嵌套事务）
      await this.markPaidTx(tx, orderId, eventCtx);
    });

    // 事务后副作用（抽到 postMarkPaidEffects，供 admin-payment 编排复用）
    await this.postMarkPaidEffects(orderId, eventCtx, orderForNotify);
  }

  /**
   * markPaid 事务内核心（抽出来供 admin payment confirm-receipt 编排复用，避嵌套事务）
   *
   * 做的事：order update CONFIRMED + orderEvent PAYMENT_SUCCESS + 销量累加（批A，与状态同事务）
   * 不做的事：事务后副作用（cancelTimeout / createTask / broadcast / notify）→ postMarkPaidEffects
   *
   * 一致性陷阱：payment.service.ts:262-278 注释警告，markPaidByAdmin 必须与 markPaid 同事务，
   * 否则留下 PaymentIntent=PAID / Order=PENDING_PAYMENT 不一致。controller 用 withTransaction
   * 包 markPaidByAdminTx + 本方法，事务提交后再调 postMarkPaidEffects。
   *
   * @internal 仅供 markPaid + admin-payment.controller 编排，不对外暴露
   */
  async markPaidTx(tx: Tx, orderId: string, eventCtx: OrderEventContext): Promise<void> {
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
    // 状态门：预付单仅 PENDING_PAYMENT 可走支付成功路径；BANK_TRANSFER 例外——
    // 初始即 PENDING_CONFIRM（order-status.machine getInitialState）且状态机无
    // PENDING_CONFIRM→PENDING_PAYMENT 流转，admin confirm-receipt（转账凭证人工审核）
    // 在此确认收款（P1-1，审查 2026-09-07）。COD 仍走 deliverTask 送达收款，不放行。
    const isBankTransferConfirm =
      order.paymentMethod === 'BANK_TRANSFER' && order.status === 'PENDING_CONFIRM';
    if (order.status !== 'PENDING_PAYMENT' && !isBankTransferConfirm) {
      throw new ConflictException({
        code: 'E-ORDER-003',
        message: `Order status ${order.status} cannot be marked as paid`,
      });
    }

    assertCanTransition(order.status, 'CONFIRMED');

    // P2-1（审查 2026-09-07）：条件翻转封并发 TOCTOU——双击支付/回调重发并发时两事务
    // 都可能读到未付快照，这里以状态条件作 UPDATE 前置（行锁 + 提交后 WHERE 复核），
    // 只有一笔能翻走；输家 count=0：并发赢家已置 PAID → 幂等 return，否则状态非法
    const flipped = await tx.order.updateMany({
      where: {
        id: orderId,
        OR: [
          { status: 'PENDING_PAYMENT' },
          { status: 'PENDING_CONFIRM', paymentMethod: 'BANK_TRANSFER' },
        ],
      },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        paymentStatus: 'PAID',
        paidAt: new Date(),
      },
    });
    if (flipped.count === 0) {
      const latest = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true, paymentStatus: true },
      });
      if (latest?.paymentStatus === 'PAID') {
        // 并发赢家已完成支付确认 → 幂等（销量只随赢家那笔累加一次）
        return;
      }
      throw new ConflictException({
        code: 'E-ORDER-003',
        message: `Order status ${latest?.status ?? order.status} cannot be marked as paid`,
      });
    }

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

    // 批A 销量真实统计（2026-09-07）：支付成功按订单行累加 Product.salesCount（与订单状态同事务）
    // 单点覆盖三条 PAID 路径：mock 回调 / 客户端 confirm 轮询 / admin confirm-receipt 编排
    // 幂等：本方法入口 order.paymentStatus === 'PAID' 提前 return，重复回调不会二次累加
    await incrementSalesCountForOrder(tx, orderId, {
      operatorId: eventCtx.operatorId ?? null,
    });
  }

  /**
   * markPaid 事务后副作用（cancelTimeout / createTask / broadcast / notify）
   * 失败容忍：任一失败不阻塞主流程（admin 可手动补 task / 重发通知）。
   * 抽出来供 admin payment confirm-receipt 编排后复用（事务提交后调）。
   */
  async postMarkPaidEffects(
    orderId: string,
    eventCtx: OrderEventContext,
    orderForNotify: {
      userId: string;
      orderNo: string;
      status: string;
      paymentStatus: string;
    } | null,
  ): Promise<void> {
    // 事务后取消超时 job（避免 job 触发时再尝试取消已 CONFIRMED 的订单）
    await cancelOrderTimeout(this.timeoutQueue, orderId);

    // 订单 CONFIRMED → 自动创建 DeliveryTask（失败容忍）
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

    // WS 广播（失败容忍）
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

    // 通知（失败容忍）
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

    // 批A A4 挂点 1：订单已确认（支付成功）→ 站内信 + PUSH（CUSTOMER, ORDER_UPDATE）
    // 失败容忍在 NotificationEventService 内部（不炸主流程）；本服务注入为 null 时跳过（单测兼容）
    if (this.notificationEvents && orderForNotify) {
      await this.notificationEvents.notify({
        event: 'orderConfirmed',
        userId: orderForNotify.userId,
        type: 'ORDER_UPDATE',
        data: { orderId, orderNo: orderForNotify.orderNo },
        params: { orderNo: orderForNotify.orderNo },
      });
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
      // 幂等守卫：非 PENDING_CONFIRM 拒绝（批3 20261012 注释订正——原「已确认直接 return」与实现相反，实为 throw E-ORDER-003）
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
      // 幂等守卫：非 CONFIRMED 拒绝（批3 20261012 注释订正——原「已拣货直接 return」与实现相反，实为 throw E-ORDER-003）
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
        orderPromotions: true,
        // P10/P11：嵌骑手详情（含 user.avatarUrl 平铺到 rider.avatarUrl），零迁移
        rider: {
          select: {
            id: true,
            riderName: true,
            phone: true,
            rating: true,
            totalDeliveries: true,
            vehicleType: true,
            user: { select: { avatarUrl: true } },
          },
        },
      },
    });
    // P27 批B1：软删订单对 client 不可见；非本人订单按 404（不暴露存在性）
    if (!order || order.userId !== userId || order.deletedAt) {
      throw new NotFoundException({
        code: 'E-ORDER-004',
        message: 'Order not found',
      });
    }
    const stockMap = await this.batchGetSkuStock(order.items.map((i: { skuId: string }) => i.skuId));
    return this.toOrderWithRelations(order, stockMap);
  }

  /**
   * 查询用户订单列表（游标分页）
   */
  async listUserOrders(
    userId: string,
    options: { status?: OrderStatusValue[]; cursor?: string; limit?: number },
  ): Promise<{ items: OrderWithRelations[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = Math.min(options.limit ?? 20, 50);
    // P27 批B1（2026-10-13）：软删订单对 client 不可见
    const where: Record<string, unknown> = { userId, deletedAt: null };
    if (options.status && options.status.length > 0) {
      where.status = { in: options.status };
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

    // F1：列表层一次查全页 skuId 的 stock（批量，避每单一次 groupBy 的 N+1）
    const skuIds = [
      ...new Set(
        items.flatMap((o: Record<string, unknown>) =>
          ((o.items as Array<{ skuId: string }>) ?? []).map((i) => i.skuId),
        ),
      ),
    ];
    const stockMap = await this.batchGetSkuStock(skuIds);
    return {
      items: items.map((o: Record<string, unknown>) => this.toOrderWithRelations(o, stockMap)),
      nextCursor: hasMore ? (items[items.length - 1] as { id: string }).id : null,
      hasMore,
    };
  }

  /**
   * 用户订单状态计数（B3，个人中心 4 宫格 badge 数据源）
   *
   * groupBy status 一次查询所有状态计数（不限分页），解决列表派生（单页 limit=20，订单超 20 偏低）。
   * 返回所有 OrderStatus 枚举值（0 填充），前端按 ORDER_COUNT_MAP 聚合 4 桶，无需处理缺失 key。
   * 注：ALL_STATUSES 与 contract OrderStatus 枚举保持一致，改枚举时同步。
   */
  async getOrderCounts(userId: string): Promise<{ counts: Record<string, number> }> {
    const rows = await db.order.groupBy({
      by: ['status'],
      // P27 批B1（2026-10-13）：软删订单不参与 4 宫格计数
      where: { userId, deletedAt: null },
      _count: { _all: true },
    });
    // F3：从 contract OrderStatus 派生，消除手动同步（改枚举自动跟随）
    const counts: Record<string, number> = {};
    for (const s of OrderStatus.options) counts[s] = 0;
    for (const r of rows) counts[r.status] = r._count._all;
    return { counts };
  }

  /**
   * P27 批B1（2026-10-13）：软删单条订单（D8 拍板不物理删）
   *
   * - 归属硬校验：非本人/不存在 → 404 E-ORDER-004（不暴露存在性）
   * - 业务约束：仅终态（COMPLETED/CANCELLED）可删，进行中 409 E-ORDER-003
   * - 软删：置 deletedAt = now()；client list/detail/counts 过滤，admin 不过滤
   */
  async deleteOrder(orderId: string, userId: string): Promise<{ success: boolean }> {
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) {
      throw new NotFoundException({ code: 'E-ORDER-004', message: 'Order not found' });
    }
    if (!isTerminalStatus(order.status)) {
      throw new ConflictException({
        code: 'E-ORDER-003',
        message: `Order status ${order.status} cannot be deleted (only terminal orders)`,
      });
    }
    await db.order.update({
      where: { id: orderId },
      data: { deletedAt: new Date() },
    });
    return { success: true };
  }

  /**
   * P27 批B1：批量软删订单。ids 空 400 / 上限 100（契约 zod 已拦，服务层兜底）/ 逐条终态校验 + 本人限定。
   * 错误码 E-ORDER-008/009（审查 P1-1：006/007 已有既定文案「已付款不能直接取消/退款金额不一致」，撞码换新段）。
   */
  async deleteOrders(userId: string, ids: string[]): Promise<{ success: boolean }> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException({ code: 'E-ORDER-008', message: 'ids is required' });
    }
    if (ids.length > 100) {
      throw new BadRequestException({ code: 'E-ORDER-009', message: 'ids limit 100' });
    }
    const orders = await db.order.findMany({
      where: { id: { in: ids }, userId },
      select: { id: true, status: true },
    });
    const nonTerminal = orders.find((o) => !isTerminalStatus(o.status));
    if (nonTerminal) {
      throw new ConflictException({
        code: 'E-ORDER-003',
        message: `Order status ${nonTerminal.status} cannot be deleted (only terminal orders)`,
      });
    }
    await db.order.updateMany({
      where: { id: { in: orders.map((o) => o.id) }, userId },
      data: { deletedAt: new Date() },
    });
    return { success: true };
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

    // F1：列表层一次查全页 skuId 的 stock（批量，避每单一次 groupBy 的 N+1）
    const skuIds = [
      ...new Set(
        items.flatMap((o: Record<string, unknown>) =>
          ((o.items as Array<{ skuId: string }>) ?? []).map((i) => i.skuId),
        ),
      ),
    ];
    const stockMap = await this.batchGetSkuStock(skuIds);
    return {
      items: items.map((o: Record<string, unknown>) => this.toOrderWithRelations(o, stockMap)),
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
        orderPromotions: true,
        // P10/P11：嵌骑手详情（含 user.avatarUrl 平铺到 rider.avatarUrl），零迁移
        rider: {
          select: {
            id: true,
            riderName: true,
            phone: true,
            rating: true,
            totalDeliveries: true,
            vehicleType: true,
            user: { select: { avatarUrl: true } },
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'E-ORDER-004',
        message: `Order not found: ${orderId}`,
      });
    }
    const stockMap = await this.batchGetSkuStock(order.items.map((i: { skuId: string }) => i.skuId));
    return this.toOrderWithRelations(order, stockMap);
  }

  /**
   * 批量查 SKU 当前库存（F1：列表层一次查全页 skuId，避每单一次 groupBy 的 N+1）
   * 复用 cart.service.batchGetSkuStock 同款逻辑（全仓库聚合 groupBy）。
   */
  private async batchGetSkuStock(skuIds: string[]): Promise<Map<string, number>> {
    if (skuIds.length === 0) return new Map();
    const rows = await db.stock.groupBy({
      by: ['skuId'],
      where: { skuId: { in: skuIds } },
      _sum: { quantity: true },
    });
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.skuId, r._sum.quantity ?? 0);
    return map;
  }

  /** Prisma Order → API DTO（DateTime → ISO 字符串），stock 由调用方批量查后传入 */
  private toOrderWithRelations(order: unknown, stockMap: Map<string, number>): OrderWithRelations {
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
      exchangeRate: number | null;
      estimatedCnyAmount: number | null;
      createdAt: Date;
      /** 预约单开门时间（保证金批A P2-1 透出）；即时单 null */
      scheduledFor: Date | null;
      confirmedAt: Date | null;
      pickedAt: Date | null;
      deliveringAt: Date | null;
      deliveredAt: Date | null;
      completedAt: Date | null;
      cancelledAt: Date | null;
      cancelReason: string | null;
      deletedAt?: Date | null; // P27 批B1：软删标记（admin 详情读非 null 标「用户已删除」）
      replacementPolicy?: string; // 替换品批1 D9（存量行 Prisma 有默认值，类型可选防旧 mock 缺字段）
      allowedReplacementSkuIds?: unknown; // D13 Json 列
      items: Array<Record<string, unknown>>;
      events: Array<Record<string, unknown>>;
      orderPromotions?: Array<Record<string, unknown>>;
      // P10/P11：详情接口 include rider（列表接口无此字段，可选）
      rider?: {
        id: string;
        riderName: string;
        phone: string;
        rating: Prisma.Decimal;
        totalDeliveries: number;
        vehicleType: string;
        user: { avatarUrl: string | null } | null;
      } | null;
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
      rider: o.rider
        ? {
            id: o.rider.id,
            riderName: o.rider.riderName,
            phone: o.rider.phone,
            // Prisma Decimal(3,2) -> string（前端 parseFloat 展示；保留 2 位精度避免 number 丢精度）
            rating: o.rider.rating.toString(),
            totalDeliveries: o.rider.totalDeliveries,
            vehicleType: o.rider.vehicleType,
            // user.avatarUrl 平铺（详情接口已 nested include；列表接口无 rider 自然不到这）
            avatarUrl: o.rider.user?.avatarUrl ?? null,
          }
        : null,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      paidAt: toIso(o.paidAt),
      // 批A 汇率快照（人民币通道下单锁定值；非人民币通道 null）
      exchangeRate: o.exchangeRate,
      estimatedCnyAmount: o.estimatedCnyAmount,
      createdAt: o.createdAt.toISOString(),
      // 预约单开门时间透出（P2-1：契约 Order.scheduledFor 已声明，详情/列表须回传）
      scheduledFor: toIso(o.scheduledFor),
      confirmedAt: toIso(o.confirmedAt),
      pickedAt: toIso(o.pickedAt),
      deliveringAt: toIso(o.deliveringAt),
      deliveredAt: toIso(o.deliveredAt),
      completedAt: toIso(o.completedAt),
      cancelledAt: toIso(o.cancelledAt),
      cancelReason: o.cancelReason,
      // P27 批B1：软删标记透出（client 详情过滤软删行恒 null；admin 详情非 null = 「用户已删除」）
      deletedAt: toIso(o.deletedAt ?? null),
      // 替换品批1（D9/D13）：策略 + 白名单透出（前端确认弹层/选品提示数据源）
      replacementPolicy: o.replacementPolicy ?? 'ALLOW',
      allowedReplacementSkuIds: (o.allowedReplacementSkuIds as string[] | null) ?? null,
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
        stock: stockMap.get(i.skuId as string),
        // 缺货履约闭环批1（2026-10-24）：实送一致性（A2）——缺货标记可空新增，向后兼容。
        // 缺货项永不参与「已送达」口径；部分缺 → 订单照常 DELIVERED* 但项显缺货标记（D18 字段永久保留）。
        outOfStockQty: (i.outOfStockQty as number | null) ?? null,
        outOfStockReason: (i.outOfStockReason as string | null) ?? null,
        outOfStockEvidenceUrls: (i.outOfStockEvidenceUrls as string[] | null) ?? [],
        suggestionItemId: (i.suggestionItemId as string | null) ?? null,
        // 替换品批1（2026-10-29 D4）：确认态透出（client 确认弹层 + admin/rider 策略展示）
        suggestionStatus: (i.suggestionStatus as string | null) ?? null,
        suggestionDecidedAt: toIso((i.suggestionDecidedAt as Date | null) ?? null),
        // 替换品批1 P2-3（2026-10-29）：建议目标摘要——join 同单目标行取快照
        //（契约只增；D8 快照改写语义下目标行未被改写，unitPrice 是决策前真实替换价，
        // 前端据此渲染原/替对比 + 差额行并明示 D1 钳制 min）
        suggestionItem: (() => {
          const sid = i.suggestionItemId as string | null;
          if (!sid) return null;
          const target = (o.items as Array<Record<string, unknown>>).find((it) => it.id === sid);
          if (!target) return null;
          return {
            name: target.productName,
            image: (target.productImage as string | null) ?? null,
            unitPrice: target.unitPrice as number,
          };
        })(),
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
      promotion:
        o.orderPromotions && o.orderPromotions.length > 0
          ? {
              promotionId: o.orderPromotions[0].promotionId as string,
              code: o.orderPromotions[0].code as string,
              discountAmount: o.orderPromotions[0].discountAmount as number,
            }
          : null,
    };
  }

  // ===================== 替换品批1（2026-10-29 D5/D6/D8） =====================

  /**
   * 替换建议决策（POST /client/orders/:orderId/items/:itemId/suggestion/decision）
   *
   *   - 归属校验：订单属本人 + item 属本单（404，不暴露存在性）
   *   - 幂等（D5）：suggestionStatus 非 PENDING → 409 E-OOS-011
   *   - accept=false（D6）：置 DECLINED + decidedAt → 走会话1 system 退款链
   *     （processOutOfStockRefund，部分缺 fullShortage=false；已置 PENDING 时登记链未退，
   *     此处为该缺货量的唯一退款路径）
   *   - accept=true（D8 原地改快照 + D1 钳制）：
   *     事务内 update itemId 行快照（productId/skuId/三快照/unitPrice=min(替换价,原价)/
   *     subtotal）+ suggestionStatus=ACCEPTED + decidedAt + 重算 Order.payableAmount
   *     （totalAmount 同步重算）+ OrderEvent(REPLACED)；替换项被消费（原项已被本行占用，
   *     无重复占用问题——快照改写语义）
   *     事务外差额退款：refundQty = 原单价-落单价 的差额折算（D1：替换价>原价钳制后
   *     差额 = (原价-min)×qty，走 system 通路合并账）
   *
   * replacementItemId 可空：缺省用登记时 item.suggestionItemId 指向的行；
   * 显式传入时校验其属本单（且不指向自身）。
   */
  async decideSuggestion(
    orderId: string,
    itemId: string,
    userId: string,
    input: { accept: boolean; replacementItemId?: string },
  ): Promise<{ itemId: string; orderId: string; suggestionStatus: 'ACCEPTED' | 'DECLINED'; replacementItemId: string | null; refundedAmount: number }> {
    // 订单归属（本人）+ 软删过滤（client 详情同口径）
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order || order.userId !== userId || order.deletedAt) {
      throw new NotFoundException({ code: 'E-ORDER-004', message: 'Order not found' });
    }
    const item = order.items.find((i) => i.id === itemId);
    if (!item) {
      throw new NotFoundException({ code: 'E-ORDER-004', message: `Order item not found in order: ${itemId}` });
    }
    // D5 幂等：非 PENDING → 409（null=未触发确认，同样不可决策）
    if (item.suggestionStatus !== 'PENDING') {
      throw new ConflictException({
        code: 'E-OOS-011',
        message: `Suggestion is not pending (status=${item.suggestionStatus ?? 'NONE'})`,
      });
    }
    // 决策窗口 = 缺货登记窗口（CONFIRMED/PICKED）+ 骑手段兜底（OUT_FOR_DELIVERY）；
    // 订单已取消（全缺已走登记链取消）→ 不可再决策
    if (!['CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY'].includes(order.status)) {
      throw new ConflictException({
        code: 'E-OOS-001',
        message: `Decision window is CONFIRMED/PICKED/OUT_FOR_DELIVERY, order status is ${order.status}`,
      });
    }

    // 决策目标：显式传入优先，否则登记时的 suggestionItemId
    const replacementId = input.replacementItemId ?? item.suggestionItemId;
    if (!replacementId) {
      throw new BadRequestException({
        code: 'E-OOS-002',
        message: 'No replacement item recorded for this suggestion',
      });
    }
    if (replacementId === itemId) {
      throw new BadRequestException({
        code: 'E-OOS-002',
        message: 'replacementItemId must reference a different item in the same order',
      });
    }
    const replacement = order.items.find((i) => i.id === replacementId);
    if (!replacement) {
      throw new BadRequestException({
        code: 'E-OOS-002',
        message: 'replacementItemId must reference an item in the same order',
      });
    }

    if (!input.accept) {
      // ===== DECLINED（D6）：走会话1 退款链 =====
      await db.orderItem.update({
        where: { id: itemId },
        data: { suggestionStatus: 'DECLINED', suggestionDecidedAt: new Date() },
      });
      const refunded = await this.triggerDeclinedRefund(order, itemId);
      // P1-2 修复（调度拍板方案 a 2026-10-29）：决策后重判全缺——该单登记时可能因
      // 带 PENDING 建议被豁免取消（cancelIfFullyOutOfStock 跳过 PENDING 项）；
      // 现在建议已拒绝，若整单无有效项（全缺）→ 走全缺取消 + 退款引擎。
      // 判定走 db（无 tx 上下文），cancelOrderInternal 幂等兜底并发。
      await this.rejudgeFullyOutOfStock(orderId, userId);
      logger.info({
        msg: 'SUGGESTION_DECIDED_DECLINED',
        orderId,
        itemId,
        refundedAmount: refunded,
      });
      return { itemId, orderId, suggestionStatus: 'DECLINED', replacementItemId: null, refundedAmount: refunded };
    }

    // ===== ACCEPTED（D8 原地改快照 + D1 钳制）=====
    // 落单价 = min(替换价, 原价)（D1：用户绝不付出更高价）
    const newUnitPrice = Math.min(replacement.unitPrice, item.unitPrice);
    const newSubtotal = newUnitPrice * item.quantity;
    const decidedAt = new Date();

    await withTransaction(async (tx: Tx) => {
      // 原地改快照（D8）：productId/skuId/productName/productImage/skuName/unitPrice/subtotal
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          productId: replacement.productId,
          skuId: replacement.skuId,
          productName: replacement.productName as Prisma.InputJsonValue,
          productImage: replacement.productImage,
          skuName: replacement.skuName as Prisma.InputJsonValue,
          unitPrice: newUnitPrice,
          subtotal: newSubtotal,
          suggestionStatus: 'ACCEPTED',
          suggestionDecidedAt: decidedAt,
        },
      });

      // 重算订单金额：totalAmount = Σ 新 subtotal；payableAmount = totalAmount + deliveryFee - discount
      const items = await tx.orderItem.findMany({ where: { orderId }, select: { subtotal: true } });
      const totalAmount = items.reduce((s, i) => s + i.subtotal, 0);
      const payableAmount = totalAmount + order.deliveryFee - order.discountAmount;
      await tx.order.update({ where: { id: orderId }, data: { totalAmount, payableAmount } });

      // D8 审计：OrderEvent(REPLACED)（项级替换不改订单状态，from = to = 当前状态）
      await tx.orderEvent.create({
        data: {
          orderId,
          eventType: 'REPLACED',
          fromStatus: order.status,
          toStatus: order.status,
          operatorId: userId,
          metadata: {
            itemId,
            replacementItemId: replacementId,
            fromSkuId: item.skuId,
            toSkuId: replacement.skuId,
            fromUnitPrice: item.unitPrice,
            appliedUnitPrice: newUnitPrice,
            clamped: replacement.unitPrice > item.unitPrice,
          } as Prisma.InputJsonValue,
        },
      });
    });

    // 事务外差额退款（D1）：落单价 < 原价时差额 = (原价 - 落单价) × qty，
    // 走 system 通路合并账（快照改写后原项 unitPrice 已是落单价，差额按决策前快照折算）。
    // 快照改写语义下 RefundItem 引用同一 orderItemId（金额按差额行记，语义=差价退还）。
    let refundedAmount = 0;
    const diffUnit = item.unitPrice - newUnitPrice;
    if (diffUnit > 0 && this.oosRefundEngine) {
      try {
        const result = await this.oosRefundEngine.processOutOfStockRefund({
          orderId,
          items: [
            {
              orderItemId: itemId,
              skuId: replacement.skuId,
              productName: replacement.productName,
              unitPrice: diffUnit,
              refundQty: item.quantity,
            },
          ],
          fullShortage: false,
          warehouseId: order.warehouseId,
        });
        refundedAmount = result.triggered ? result.amount : 0;
        // P3-2（审查 20261029）：引擎规则未命中（partialShortage 开关关/阈值未达）时
        // triggered=false 静默不退——差额让利语义是「替换必退差价」，静默零退款至少要可观测
        if (!result.triggered) {
          logger.warn({
            msg: 'SUGGESTION_DIFF_REFUND_NOT_TRIGGERED',
            orderId,
            itemId,
            diffUnit,
            mode: result.mode,
            hint: 'refund engine rule not met (partialShortage switch/threshold); manual refund may be needed',
          });
        }
      } catch (e) {
        // 差额退款失败不回滚替换事实（同登记链纪律：告警后继续，人工可补）
        logger.error({
          msg: 'SUGGESTION_DIFF_REFUND_FAILED',
          orderId,
          itemId,
          diffUnit,
          error: (e as Error).message,
        });
      }
    }

    // 推送（事务外，notify 吞错）：采纳确认（复用 outOfStock 事件族外新 key）
    if (this.notificationEvents) {
      try {
        await this.notificationEvents.notify({
          event: 'orderConfirmed',
          userId,
          type: 'ORDER_UPDATE',
          data: { orderId, orderNo: order.orderNo, itemId, replacementItemId: replacementId, suggestionAccepted: true },
          params: { orderNo: order.orderNo ?? '' },
        });
      } catch {
        // 吞错（notify 内部亦吞错，双保险）
      }
    }

    logger.info({
      msg: 'SUGGESTION_DECIDED_ACCEPTED',
      orderId,
      itemId,
      replacementItemId: replacementId,
      appliedUnitPrice: newUnitPrice,
      clamped: replacement.unitPrice > item.unitPrice,
      refundedAmount,
    });
    return { itemId, orderId, suggestionStatus: 'ACCEPTED', replacementItemId: replacementId, refundedAmount };
  }

  /**
   * P1-2 修复（调度拍板方案 a 2026-10-29）：决策后全缺重判。
   *
   * 背景：登记链 cancelIfFullyOutOfStock（out-of-stock.service）在全缺判定时跳过
   * 带 PENDING 建议的项（豁免取消，等决策）——否则全缺×PENDING 会把订单锁进
   * CANCELLED，决策窗口 409 + processor 候选过滤排除 → 退款死锁。
   *
   * 本方法在决策落地后调用（DECINED / 超时拒绝两路）：重读整单，若全部项已登记
   * 缺货（此时 PENDING 已清，无豁免对象）→ 复用 cancelOrderInternal 取消
   * （reason=OUT_OF_STOCK，同登记链 D11 语义）+ 触发全缺退款引擎。
   * 幂等：cancelOrderInternal 终态守卫 + 引擎合并账。
   */
  async rejudgeFullyOutOfStock(orderId: string, operatorId: string): Promise<void> {
    try {
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: { status: true, warehouseId: true, items: { select: { outOfStockQty: true, quantity: true } } },
      });
      if (!order || order.status === 'CANCELLED' || order.status === 'COMPLETED') return;
      const fullyShort =
        order.items.length > 0 && order.items.every((i) => i.outOfStockQty != null && i.outOfStockQty >= i.quantity);
      if (!fullyShort) return;
      logger.info({ msg: 'SUGGESTION_DECIDED_REJUDGE_FULL_SHORTAGE', orderId });
      await this.cancelOrderInternal(orderId, {
        operatorId,
        deviceType: 'system' as ContractDeviceType,
        perspective: 'system',
        reason: 'OUT_OF_STOCK',
      });
      // 全缺退款走引擎（fullShortage=true，规则判定 fullShortage 开关）
      if (this.oosRefundEngine) {
        const items = await db.orderItem.findMany({
          where: { orderId, outOfStockQty: { not: null } },
          select: { id: true, skuId: true, productName: true, unitPrice: true, outOfStockQty: true },
        });
        if (items.length > 0) {
          await this.oosRefundEngine.processOutOfStockRefund({
            orderId,
            items: items.map((i) => ({
              orderItemId: i.id,
              skuId: i.skuId,
              productName: i.productName,
              unitPrice: i.unitPrice,
              refundQty: i.outOfStockQty ?? 0,
            })),
            fullShortage: true,
            warehouseId: order.warehouseId,
          });
        }
      }
    } catch (e) {
      // 重判失败不阻断决策返回（取消/退款可人工补——单次补偿纪律）
      logger.error({
        msg: 'SUGGESTION_REJUDGE_FAILED',
        orderId,
        error: (e as Error).message,
      });
    }
  }

  /**
   * DECLINED 退款（D6）：把该缺货项折算成退款候选走会话1 system 通路。
   * 注意：决策点在置 DECLINED 之后，退款失败仅告警（可人工补）。
   */
  private async triggerDeclinedRefund(
    order: { id: string; warehouseId: string },
    itemId: string,
  ): Promise<number> {
    if (!this.oosRefundEngine) return 0;
    try {
      const item = await db.orderItem.findUnique({
        where: { id: itemId },
        select: { skuId: true, productName: true, unitPrice: true, outOfStockQty: true },
      });
      if (!item?.outOfStockQty) return 0;
      const result = await this.oosRefundEngine.processOutOfStockRefund({
        orderId: order.id,
        items: [
          {
            orderItemId: itemId,
            skuId: item.skuId,
            productName: item.productName,
            unitPrice: item.unitPrice,
            refundQty: item.outOfStockQty,
          },
        ],
        fullShortage: false,
        warehouseId: order.warehouseId,
      });
      return result.triggered ? result.amount : 0;
    } catch (e) {
      logger.error({
        msg: 'SUGGESTION_DECLINED_REFUND_FAILED',
        orderId: order.id,
        itemId,
        error: (e as Error).message,
      });
      return 0;
    }
  }

  /**
   * 替换品批1（D7）：超时自动拒绝后的退款 + 推送（suggestion-timeout.processor 调用）。
   * item 已由 processor 置 DECLINED；本方法只做退款候选折算 + outOfStockSuggestionExpired 推送。
   * 决策窗口/幂等已由 processor 校验（此处不重查状态，单次补偿纪律：失败仅告警）。
   */
  async decideSuggestionTimeoutRefund(orderId: string, itemId: string): Promise<void> {
    const refunded = await this.triggerDeclinedRefund({ id: orderId, warehouseId: '' }, itemId);
    // P1-2 修复：超时自动拒绝同样触发全缺重判（豁免取消的单，拒绝后可能真全缺 → 取消+退款）
    await this.rejudgeFullyOutOfStock(orderId, 'system');
    // 推送超时通知（事务外，notify 吞错）
    if (this.notificationEvents) {
      try {
        const item = await db.orderItem.findUnique({
          where: { id: itemId },
          select: { order: { select: { userId: true, orderNo: true, warehouseId: true } } },
        });
        if (item) {
          await this.notificationEvents.notify({
            event: 'outOfStockSuggestionExpired',
            userId: item.order.userId,
            type: 'ORDER_UPDATE',
            data: { orderId, orderNo: item.order.orderNo, itemId },
            params: { orderNo: item.order.orderNo ?? '' },
          });
        }
      } catch {
        // 吞错
      }
    }
    logger.info({ msg: 'SUGGESTION_TIMEOUT_DECLINED', orderId, itemId, refundedAmount: refunded });
  }
}
