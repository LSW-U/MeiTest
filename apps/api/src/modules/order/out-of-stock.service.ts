/**
 * OutOfStockService — 缺货登记（缺货履约闭环批1 2026-10-24）
 *
 * 权威方案：方案v3-缺货履约闭环与自动退款-20261024 §一 D7/D11/D12/D18/D19
 *
 * 两个登记入口（D7 登记主体分权）：
 *   - 仓库侧（admin）：POST /admin/orders/:id/items/:itemId/out-of-stock，窗口 CONFIRMED/PICKED
 *   - 骑手兜底：POST /rider/orders/:id/out-of-stock，窗口 DELIVERING（OUT_FOR_DELIVERY 态），仅部分缺（D12）
 *
 * 全缺判定（仅拣货段，D11）：整单全部项缺 → 订单 CANCELLED(reason=OUT_OF_STOCK)，
 * 走 cancelOrderInternal 既有取消链（释放库存 + 关配送任务 + 写事件），状态机零改动。
 *
 * 错误码段（D19，独立 E-OOS 段）：
 *   E-OOS-001 窗口非法 / 002 数量非法 / 003 重复登记 / 004 骑手段禁全缺 / 005 证据 URL 非法
 *   替换品批1 2026-10-29：009 策略 NONE 禁建议项 / 010 建议项不在 SPECIFY 白名单
 *
 * 本批不建退款单（批3）——全缺只落 CANCELLED。
 * 批2（2026-10-24，D16）：登记事务 commit 后同步直推 outOfStock 事件（不进 BullMQ、
 * 不经 E3 频控闸 D8）；推送失败不回滚登记，告警 + 单次补偿重试。
 */
import { Inject, Injectable, NotFoundException, ConflictException, BadRequestException, Optional } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db, withTransaction, type Tx } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { StorageService } from '../../shared/storage/storage.service';
import { OrderService } from './order.service';
import type { NotificationEventService } from '../notification/notification-event.service';
import { OutOfStockRefundService } from './out-of-stock-refund.service';
import { toPrismaDeviceType } from './order.types';
import type { ContractDeviceType } from './order.types';

/** 取证照片上限（dispatch MAX_EVIDENCE_URLS 同套语义，D5） */
const MAX_EVIDENCE_URLS = 3;

/** 缺货原因枚举（登记快照，自由值落 outOfStockReason） */
export const OUT_OF_STOCK_REASONS = ['DAMAGED', 'EXPIRED', 'MISSING', 'MISLABELED', 'OTHER'] as const;
export type OutOfStockReason = (typeof OUT_OF_STOCK_REASONS)[number];

/** 仓库侧登记输入 */
export interface AdminOutOfStockInput {
  operatorId: string;
  deviceType?: ContractDeviceType;
  perspective?: string;
  /** 缺货数量（1..quantity） */
  outOfStockQty: number;
  /** 缺货原因（OUT_OF_STOCK_REASONS 之一） */
  reason: OutOfStockReason;
  /** 备注（可空，≤200） */
  note?: string | null;
  /** 取证照片（≤3，isOwnUrl 校验） */
  evidenceUrls?: string[];
  /** 替代建议项（可空，service 层校验本单归属，D18） */
  suggestionItemId?: string | null;
}

/** 骑手兜底登记输入（无 evidenceUrls 简化版可带；仅部分缺 D12） */
export interface RiderOutOfStockInput {
  riderUserId: string;
  /** 缺货数量（1..quantity，仅单累计部分缺） */
  outOfStockQty: number;
  reason: OutOfStockReason;
  note?: string | null;
  evidenceUrls?: string[];
  suggestionItemId?: string | null;
}

/** 登记结果 */
export interface OutOfStockReportResult {
  itemId: string;
  orderId: string;
  outOfStockQty: number;
  /** 本次登记是否触发整单全缺 → 订单已取消（D11） */
  orderCancelled: boolean;
  /** 替换品批1（D6）：本次登记带建议项且已置 PENDING（true = 退款引擎跳过，等用户决策/超时） */
  suggestionPending?: boolean;
}

@Injectable()
export class OutOfStockService {
  constructor(
    // 批1：evidenceUrls 前缀校验需 StorageService（isOwnUrl 语义，同 dispatch.service.ts:526 先例）
    @Inject(StorageService) private readonly storage: StorageService | null,
    // 全缺 → CANCELLED 复用 OrderService.cancelOrderInternal 既有取消链（D11 零状态机改动）
    @Inject(OrderService) private readonly orderService: OrderService,
    // 批2（D16）：同步直推。@Optional 兜底单测直 new 不传（notify 内部全链 try/catch 容忍）；
    // DI 显式 token（tsx 无 decorator metadata，order.module 已注册 useExisting）
    @Optional() @Inject('NotificationEventServiceToken')
    private readonly notificationEvents?: NotificationEventService | null,
    // 批3（D9b）：登记 commit 后触发 system 自动退款引擎（@Optional 同上，单测兜底）
    @Optional() @Inject(OutOfStockRefundService)
    private readonly refundEngine?: OutOfStockRefundService | null,
  ) {}

  /**
   * 仓库侧登记（admin）——窗口 CONFIRMED/PICKED
   *
   * 校验链：订单存在 → 窗口 → 项属于本单 → 数量 ≤ quantity → 重复登记幂等（E-OOS-003）
   *   → suggestionItemId 本单归属（D18）→ evidenceUrls 校验 → 写字段 + OrderEvent
   *   → 全缺判定（CONFIRMED/PICKED 才判，D11）→ CANCELLED
   */
  async adminReportItemOutOfStock(
    orderId: string,
    itemId: string,
    input: AdminOutOfStockInput,
  ): Promise<OutOfStockReportResult> {
    // 事务外预读用于返回值与全缺判定；权威校验在事务内重读（乐观并发）
    const preOrder = await db.order.findUnique({
      where: { id: orderId },
      select: { status: true, paymentStatus: true },
    });
    if (!preOrder) {
      throw new NotFoundException({ code: 'E-ORDER-004', message: `Order not found: ${orderId}` });
    }
    // 窗口校验（E-OOS-001）：仅 CONFIRMED/PICKED（D7 拣货段）
    if (preOrder.status !== 'CONFIRMED' && preOrder.status !== 'PICKED') {
      throw new ConflictException({
        code: 'E-OOS-001',
        message: `Out-of-stock reporting window is CONFIRMED/PICKED, order status is ${preOrder.status}`,
      });
    }

    const item = await db.orderItem.findUnique({ where: { id: itemId } });
    if (!item || item.orderId !== orderId) {
      throw new NotFoundException({ code: 'E-ORDER-005', message: `Order item not found in order: ${itemId}` });
    }
    this.assertQtyAndEvidence(item.quantity, input.outOfStockQty, input.evidenceUrls);
    await this.assertSuggestionItemBelongsToOrder(orderId, itemId, input.suggestionItemId);
    // 替换品批1（D9/D13）：订单级策略校验建议项合法性（NONE 禁 / SPECIFY 白名单）
    await this.assertSuggestionAllowedByPolicy(orderId, input.suggestionItemId);

    // 重复登记幂等（E-OOS-003）：已登记过缺货的项拒绝再次登记（字段永久保留 D18，不覆盖）
    if (item.outOfStockQty != null) {
      throw new ConflictException({
        code: 'E-OOS-003',
        message: `Item ${itemId} already reported out of stock (qty=${item.outOfStockQty})`,
      });
    }

    // P2-2：登记开始时刻（预读前），补偿探针时间窗下界——同单二次登记不命中旧行
    const startedAt = new Date();
    // P2-1（审查 20261024）：登记 + 事件 + 全缺判定收进同一事务——两个 staff 并发登记
    // 最后两个未登记项时，事务外先 update 再重读会让两次全缺判定都读到对方提交前快照
    // → 漏取消。ReadCommitted 下事务内 update 持行锁，重读可见对方已提交行，判定原子。
    // cancelOrderInternal 自身幂等（updateMany 条件守卫）兜底取消侧并发，不收进本事务
    // （其内部自带 withTransaction，嵌套会开独立事务，语义仍正确：判定为真才走到它）。
    const result = await withTransaction(async (tx: Tx) => {
      // 替换品批1（D6）：登记带建议项且策略允许 → 置 PENDING 锁定（不直退）；
      // ACCEPTED/DECLINED 决策后再走差额/全额退款。NONE/SPECIFY 非法已在上方拦截。
      const suggestionPending = Boolean(input.suggestionItemId) && (await this.policyAllowsSuggestion(orderId));
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          outOfStockQty: input.outOfStockQty,
          outOfStockReason: input.reason,
          outOfStockNote: input.note?.trim() ? input.note.trim().slice(0, 200) : null,
          outOfStockEvidenceUrls: input.evidenceUrls ?? [],
          suggestionItemId: input.suggestionItemId ?? null,
          ...(suggestionPending ? { suggestionStatus: 'PENDING' as const } : {}),
        },
      });

      await this.writeReportEvent(
        orderId,
        {
          itemId,
          outOfStockQty: input.outOfStockQty,
          reason: input.reason,
          source: 'ADMIN',
          operatorId: input.operatorId,
          deviceType: input.deviceType,
          perspective: input.perspective,
        },
        tx,
      );

      logger.info({
        msg: 'OUT_OF_STOCK_REPORTED_ADMIN',
        orderId,
        itemId,
        qty: input.outOfStockQty,
        reason: input.reason,
      });

      // 全缺判定（仅拣货段窗口，D11）：事务内重读全部项 → 全缺则 CANCELLED。
      // 必须传 tx：本事务刚写的 outOfStockQty 未 commit，走 db 全局连接读不到（快照隔离），
      // 会恒判不全缺 → orderCancelled 恒 false（e2e 实证 20261024）
      const orderCancelled = await this.cancelIfFullyOutOfStock(orderId, {
        operatorId: input.operatorId,
        deviceType: input.deviceType,
        perspective: input.perspective,
      }, tx);

      return { itemId, orderId, outOfStockQty: input.outOfStockQty, orderCancelled, suggestionPending };
    });

    // 批2（D16）：事务已 commit，同步直推（推送失败不回滚登记——notify 内部全链 try/catch +
    // 本方法单次补偿重试，见 notifyOutOfStock）；P3-3 全缺 → cancelled 分支文案
    await this.notifyOutOfStock(orderId, itemId, input.outOfStockQty, {
      startedAt,
      orderCancelled: result.orderCancelled,
      suggestionPending: result.suggestionPending,
    });
    // 批3（D9b）：事务已 commit，触发 system 自动退款引擎（内部规则判定，不命中静默返回）
    // 替换品批1（D6）：登记带建议项且置了 PENDING → 不直退（退款决策权交用户决策端点/超时队列）
    if (!result.suggestionPending) {
      await this.triggerRefundEngine(orderId, result.orderCancelled);
    }
    return result;
  }

  /**
   * 骑手兜底登记——窗口 DELIVERING（订单 OUT_FOR_DELIVERY 态），仅部分缺（D12）
   *
   * 定位：骑手任务详情页按单登记（body 不带 itemId 语义不同——骑手端只见 items 列表，
   * body.itemIds 显式声明哪些项缺货）。骑手段禁全缺：登记后仍缺正数项 → E-OOS-004。
   */
  async riderReportOutOfStock(
    orderId: string,
    input: RiderOutOfStockInput,
  ): Promise<OutOfStockReportResult> {
    const preOrder = await db.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (!preOrder) {
      throw new NotFoundException({ code: 'E-ORDER-004', message: `Order not found: ${orderId}` });
    }
    // 窗口校验（E-OOS-001）：订单须在 OUT_FOR_DELIVERY（对应任务 DELIVERING）
    if (preOrder.status !== 'OUT_FOR_DELIVERY') {
      throw new ConflictException({
        code: 'E-OOS-001',
        message: `Rider out-of-stock reporting window is OUT_FOR_DELIVERY, order status is ${preOrder.status}`,
      });
    }

    const items = await db.orderItem.findMany({ where: { orderId }, orderBy: { id: 'asc' } });
    if (items.length === 0) {
      throw new NotFoundException({ code: 'E-ORDER-005', message: 'Order has no items' });
    }
    // 骑手段登记的目标项集：所有项（骑手只报「这单缺 X 件」粒度不精细到项时，
    // 按任务书简化版 UI：项选择 + 数量）——这里取 body 指定项；未指定项单条路径走 admin 端点。
    // D12：骑手段全缺请求直接拒（先算累计已缺 + 本次将缺，若覆盖整单全部数量 → E-OOS-004）
    const alreadyShort = items.reduce((sum, i) => sum + (i.outOfStockQty ?? 0), 0);
    const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
    if (alreadyShort + input.outOfStockQty >= totalQty) {
      throw new ConflictException({
        code: 'E-OOS-004',
        message: 'Full shortage can only be reported at picking stage (rider stage allows partial only)',
      });
    }
    if (input.outOfStockQty <= 0) {
      throw new BadRequestException({
        code: 'E-OOS-002',
        message: 'outOfStockQty must be positive',
      });
    }

    // P2-2：登记开始时刻，补偿探针时间窗下界（骑手链同 admin）
    const startedAt = new Date();
    // 骑手段按单累计登记：写到第一个未登记项（简化语义：骑手端不做项级精细分摊，
    // 缺货量落到首项，剩余项保持未缺——两账分离，退款金额批3 引擎按项级字段算）
    // 找一个还有余量的项落账（已登记满的项跳过）
    const target = items.find((i) => (i.outOfStockQty ?? 0) === 0 && i.quantity > 0);
    if (!target) {
      throw new ConflictException({
        code: 'E-OOS-003',
        message: 'All items already reported out of stock for this order',
      });
    }
    // 目标项容量校验：单项容量不足时 E-OOS-002（骑手端不支持跨项分摊，UI 侧控制）
    if (input.outOfStockQty > target.quantity) {
      throw new BadRequestException({
        code: 'E-OOS-002',
        message: `outOfStockQty ${input.outOfStockQty} exceeds item quantity ${target.quantity}`,
      });
    }

    this.assertEvidence(input.evidenceUrls);
    const targetId = target.id;
    await this.assertSuggestionItemBelongsToOrder(orderId, targetId, input.suggestionItemId);
    // 替换品批1（D9/D13）：骑手段同套策略校验（NONE 禁 / SPECIFY 白名单）
    await this.assertSuggestionAllowedByPolicy(orderId, input.suggestionItemId);

    // P2-1 同口径：登记 + 事件收进事务（骑手段永不触发取消，无判定侧并发问题，
    // 事务化只为两步写原子性）
    const result = await withTransaction(async (tx: Tx) => {
      // 替换品批1（D6）：登记带建议项且策略允许 → 置 PENDING 锁定（同 admin 链）
      const suggestionPending = Boolean(input.suggestionItemId) && (await this.policyAllowsSuggestion(orderId));
      await tx.orderItem.update({
        where: { id: targetId },
        data: {
          outOfStockQty: input.outOfStockQty,
          outOfStockReason: input.reason,
          outOfStockNote: input.note?.trim() ? input.note.trim().slice(0, 200) : null,
          outOfStockEvidenceUrls: input.evidenceUrls ?? [],
          suggestionItemId: input.suggestionItemId ?? null,
          ...(suggestionPending ? { suggestionStatus: 'PENDING' as const } : {}),
        },
      });

      await this.writeReportEvent(
        orderId,
        {
          itemId: targetId,
          outOfStockQty: input.outOfStockQty,
          reason: input.reason,
          source: 'RIDER',
          operatorId: input.riderUserId,
        },
        tx,
      );

      logger.info({
        msg: 'OUT_OF_STOCK_REPORTED_RIDER',
        orderId,
        itemId: targetId,
        qty: input.outOfStockQty,
        reason: input.reason,
      });

      return { itemId: targetId, orderId, outOfStockQty: input.outOfStockQty, orderCancelled: false, suggestionPending };
    });

    // 批2（D16）：事务已 commit，同步直推（同 admin 链）；骑手段恒部分缺（D12）→ 非取消文案
    await this.notifyOutOfStock(orderId, targetId, input.outOfStockQty, {
      startedAt,
      orderCancelled: false,
      suggestionPending: result.suggestionPending,
    });
    // 批3（D9b）：骑手段恒部分缺 → fullShortage=false（引擎侧阈值开关默认关，不命中静默返回）
    // 替换品批1（D6）：同 admin 链，PENDING 锁定时跳过退款引擎
    if (!result.suggestionPending) {
      await this.triggerRefundEngine(orderId, false);
    }
    return result;
  }

  // ===================== 内部 =====================

  /**
   * 批3（D15/D17）：全局规则更新委托（admin 端点调用，真源规则表 + SystemConfig 镜像同事务）。
   * 引擎未注入（单测）时防御直抛——规则页是运营动作，静默假成功不可接受。
   */
  async updateGlobalRule(input: {
    autoRefundFullShortage?: boolean;
    partialShortageThresholdEnabled?: boolean;
    partialShortageThresholdBp?: number | null;
    autoRefundMaxAmount?: number;
  }): Promise<void> {
    if (!this.refundEngine) {
      // P3-2（审查修复 20261024）：引擎未注入（装配异常/单测）≠规则禁用——E-OOS-007 语义
      // 改为「自动退款引擎不可用」，与并发冲突 E-OOS-008 分开
      throw new ConflictException({
        code: 'E-OOS-007',
        message: 'Refund engine not available',
      });
    }
    await this.refundEngine.updateGlobalRule(input);
  }

  /**
   * 批3（D9b）：system 自动退款引擎触发（登记事务 commit 后、事务外）
   *
   * 构造 OosRefundCandidate：全量已登记项（含历史项——合并账时一次入账）+ 本次全缺判定结果。
   * 引擎内部规则判定（开关关/阈值未命中静默返回 triggered=false），调用方不感知结果。
   * 推送由引擎内部完成（notify 吞错纪律）；引擎未注入（单测）或抛错时仅告警，
   * 不影响登记事实（与 notifyOutOfStock 同款失败不回滚纪律）。
   */
  private async triggerRefundEngine(orderId: string, fullShortage: boolean): Promise<void> {
    if (!this.refundEngine) return;
    try {
      const items = await db.orderItem.findMany({
        where: { orderId, outOfStockQty: { not: null } },
        select: { id: true, skuId: true, productName: true, unitPrice: true, outOfStockQty: true },
      });
      if (items.length === 0) return;
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: { warehouseId: true },
      });
      await this.refundEngine.processOutOfStockRefund({
        orderId,
        items: items.map((i) => ({
          orderItemId: i.id,
          skuId: i.skuId,
          productName: i.productName,
          unitPrice: i.unitPrice,
          refundQty: i.outOfStockQty ?? 0,
        })),
        fullShortage,
        warehouseId: order?.warehouseId ?? null,
      });
    } catch (e) {
      // 退款引擎失败不回滚登记（D9b：登记是事实，退款可人工补——告警后继续）
      logger.error({
        msg: 'OOS_REFUND_ENGINE_FAILED',
        orderId,
        fullShortage,
        error: (e as Error).message,
      });
    }
  }

  /**
   * 缺货登记推送（批2，D16 同步直推；P2-2/P3-2/P3-3 审查修复 20261024）
   *
   * 挂点：两条登记链事务 commit 之后（通知一律放事务外，notification-event.service 既有纪律）。
   * 语义：
   *   - 事件 outOfStock（受众 CUSTOMER、ORDER_UPDATE），data.orderId + 缺货项摘要（品名/数量）
   *     —— client-app 深链跳订单详情（routeFromPushData ORDER_UPDATE + orderId 既有分流，
   *     缺货标记由批1 items 新字段在详情页可见）
   *   - P3-3：orderCancelled=true（全缺 → 订单已 CANCELLED）时 data.cancelled=true，
   *     五语模板 content 分支「订单已取消-全部商品缺货」（模板 params.cancelled 渲染差异文案）
   *   - P3-2：摘要品名兜底链 en → productName Json 首个可用值（pt/tet 用户至少拿到快照里
   *     首语言而非空串）；按用户 locale 精确匹配留批3 五语透传
   *   - 推送失败不回滚登记：notify 内部全链 try/catch；本方法再补一次显式重试（单次补偿，
   *     Q7 拍板），两次都失败仅告警日志（OUT_OF_STOCK_NOTIFY_FAILED），登记事实不受影响
   *   - P2-2 补偿探针收窄时间窗：startedAt 取自登记事务开始前（调用方传入），探针加
   *     createdAt >= startedAt——同单二次登记不再命中首次登记的旧行假阳性，零侵入不改 notify 签名
   *   - 不进 BullMQ（D16：省一跳队列延迟，A1 ≤1 分钟走最短路径）、不经 E3 频控闸（D8）
   *   - notificationEvents 未注入（单测）时静默跳过
   */
  private async notifyOutOfStock(
    orderId: string,
    itemId: string,
    outOfStockQty: number,
    // 替换品批1（D6）：带建议项且策略放行 → suggestionPending=true，通知走
    // outOfStockSuggestion 模板（shared-locales 五语已配）且 data 带 replacementItem
    //（client-app NotificationItem CTA 既有探针：data.replacementItem → swap 图标 + viewDetails CTA）
    opts: { startedAt: Date; orderCancelled: boolean; suggestionPending?: boolean },
  ): Promise<void> {
    if (!this.notificationEvents) return;
    try {
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: { userId: true, orderNo: true },
      });
      if (!order?.userId) {
        logger.warn({ msg: 'OUT_OF_STOCK_NOTIFY_SKIPPED', orderId, reason: 'no userId' });
        return;
      }
      // P3-2：品名兜底链 en → 首个可用值（productName Json 为 Record<lang,string> 快照，
      // Object.values 顺序即写入序；全空才落空串）。按用户 locale 渲染留批3 五语透传
      const item = await db.orderItem.findUnique({
        where: { id: itemId },
        select: { productName: true },
      });
      const nameRecord = (item?.productName ?? {}) as Record<string, string>;
      const itemName = nameRecord.en ?? Object.values(nameRecord).find(Boolean) ?? '';
      const itemsSummary = `${itemName} x${outOfStockQty}`;

      // P3-3：全缺 → 订单已取消，模板渲染「已取消-全部商品缺货」分支文案
      // （outOfStock.cancelled.*；部分缺走默认 *.* 文案）
      const cancelled = opts.orderCancelled;
      // 替换品批1（D6）：带建议项 PENDING → 专用模板（客户端 CTA 跳详情确认弹层）
      const eventKey = opts.suggestionPending
        ? 'outOfStockSuggestion'
        : cancelled
          ? 'outOfStockCancelled'
          : 'outOfStock';
      const params: Record<string, string> = { orderNo: order.orderNo ?? '', items: itemsSummary };

      // notify 全链吞错恒 resolve（不炸主流程的既有纪律），调用侧无法用返回值判断成败；
      // 以「Notification 行是否落库」为成功探针（data.orderId 精确匹配 + P2-2 时间窗
      // createdAt >= startedAt——同单二次登记不命中旧行假阳性），未落库 = 失败 → 单次补偿重试（D16 Q7），再失败仅告警
      const attempt = async (): Promise<boolean> => {
        await this.notificationEvents!.notify({
          event: eventKey,
          userId: order.userId,
          type: 'ORDER_UPDATE',
          data: {
            orderId,
            orderNo: order.orderNo,
            itemsSummary,
            cancelled,
            // client-app NotificationItem 既有探针字段：data.replacementItem 非空 →
            // swap 图标 + viewDetails CTA（跳详情确认弹层）。建议项 ID 由登记入参取
            ...(opts.suggestionPending ? { replacementItem: itemId } : {}),
          },
          params,
        });
        const row = await db.notification.findFirst({
          where: {
            userId: order.userId,
            data: { path: ['orderId'], equals: orderId },
            createdAt: { gte: opts.startedAt },
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        return row != null;
      };

      if (await attempt()) return;
      // 单次补偿重试（仍失败 → 告警日志，登记事实不受影响）
      const retried = await attempt();
      if (!retried) {
        logger.warn({
          msg: 'OUT_OF_STOCK_NOTIFY_FAILED',
          orderId,
          itemId,
          error: 'notification row missing after 1 compensation retry',
        });
      }
    } catch (e) {
      // notify 恒不抛；此 catch 防御 direct-mock 单测注入抛错实现
      logger.warn({
        msg: 'OUT_OF_STOCK_NOTIFY_FAILED',
        orderId,
        itemId,
        error: (e as Error).message,
      });
    }
  }

  /** 数量 + 证据统一校验（admin 路径；数量 1..quantity） */
  private assertQtyAndEvidence(itemQty: number, outOfStockQty: number, evidenceUrls?: string[]): void {
    if (!Number.isInteger(outOfStockQty) || outOfStockQty <= 0 || outOfStockQty > itemQty) {
      throw new BadRequestException({
        code: 'E-OOS-002',
        message: `outOfStockQty must be integer in [1, ${itemQty}], got ${outOfStockQty}`,
      });
    }
    this.assertEvidence(evidenceUrls);
  }

  /**
   * evidenceUrls 校验（dispatch validateEvidenceUrls 同套语义，D5）
   *
   * - 数量 ≤ MAX_EVIDENCE_URLS（DTO 已 max 3，服务端再校验防御直调）
   * - 每条 URL 前缀必须为本服务 MinIO/上传域（isOwnUrl，防外链/SSRF）
   * - 非法 → 400 E-OOS-005
   * - storage 未注入（单测 null 兼容）时跳过前缀校验仅查数量
   */
  private assertEvidence(evidenceUrls?: string[]): void {
    if (!evidenceUrls || evidenceUrls.length === 0) return;
    if (evidenceUrls.length > MAX_EVIDENCE_URLS) {
      throw new BadRequestException({
        code: 'E-OOS-005',
        message: `Too many evidence URLs (max ${MAX_EVIDENCE_URLS})`,
      });
    }
    if (this.storage) {
      for (const url of evidenceUrls) {
        if (!this.storage.isOwnUrl(url)) {
          throw new BadRequestException({
            code: 'E-OOS-005',
            message: 'Evidence URL must be uploaded via platform upload endpoint (external URL rejected)',
          });
        }
      }
    } else {
      logger.warn('out-of-stock evidence prefix check skipped: storage not injected');
    }
  }

  /**
   * suggestionItemId 本单归属校验（D18，service 层）
   * 替代建议语义上是别的项：禁指向自身（P3-3，审查 20261024——API 直调防线，UI 已过滤）
   */
  private async assertSuggestionItemBelongsToOrder(
    orderId: string,
    itemId: string,
    suggestionItemId?: string | null,
  ): Promise<void> {
    if (!suggestionItemId) return;
    if (suggestionItemId === itemId) {
      throw new BadRequestException({
        code: 'E-OOS-002',
        message: 'suggestionItemId must reference a different item in the same order',
      });
    }
    const suggestion = await db.orderItem.findUnique({ where: { id: suggestionItemId } });
    if (!suggestion || suggestion.orderId !== orderId) {
      throw new BadRequestException({
        code: 'E-OOS-002',
        message: 'suggestionItemId must reference an item in the same order',
      });
    }
  }

  /**
   * 替换品批1（D9/D13）：订单级策略校验建议项合法性（替换品批1 新增，2026-10-29）
   *
   *   - NONE 策略 → 禁建议项（E-OOS-009）
   *   - SPECIFY 策略 → 建议 skuId 必须在 allowedReplacementSkuIds 白名单（E-OOS-010）
   *   - ALLOW（或存量缺省）→ 不限
   *
   * 建议项 skuId 取被建议行（suggestionItemId 指向的项）的 skuId——白名单语义是
   * 「允许被换成哪些 SKU」。归属校验已在 assertSuggestionItemBelongsToOrder 完成。
   */
  private async assertSuggestionAllowedByPolicy(orderId: string, suggestionItemId?: string | null): Promise<void> {
    if (!suggestionItemId) return;
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { replacementPolicy: true, allowedReplacementSkuIds: true },
    });
    if (!order) return; // 归属校验链上游已挡
    if (order.replacementPolicy === 'NONE') {
      throw new ConflictException({
        code: 'E-OOS-009',
        message: 'Order policy NONE does not allow replacement suggestions',
      });
    }
    if (order.replacementPolicy === 'SPECIFY') {
      const suggestion = await db.orderItem.findUnique({
        where: { id: suggestionItemId },
        select: { skuId: true },
      });
      const whitelist = Array.isArray(order.allowedReplacementSkuIds)
        ? (order.allowedReplacementSkuIds as string[])
        : [];
      if (!suggestion || !whitelist.includes(suggestion.skuId)) {
        throw new ConflictException({
          code: 'E-OOS-010',
          message: 'Suggested replacement SKU is not in the order whitelist',
        });
      }
    }
  }

  /**
   * 替换品批1（D6）：策略是否允许建议项（登记事务内置 PENDING 前判定）。
   * NONE → false；ALLOW/SPECIFY（建议项合法性已由 assertSuggestionAllowedByPolicy 硬校验）→ true。
   */
  private async policyAllowsSuggestion(orderId: string): Promise<boolean> {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { replacementPolicy: true },
    });
    return order?.replacementPolicy !== 'NONE';
  }

  /**
   * 全缺判定（D11，仅拣货段调用）：重读订单全部项，全部项 outOfStockQty = quantity → CANCELLED
   *
   * 走 OrderService.cancelOrderInternal 既有取消链（释放库存 + 关 PENDING_ASSIGN/ASSIGNED
   * 配送任务 + 写 CANCELLED 事件 + WS 广播 + 站内信），reason=OUT_OF_STOCK。
   * cancelOrderInternal 幂等（已终态 return），并发登记双触发全缺时只取消一次。
   */
  private async cancelIfFullyOutOfStock(
    orderId: string,
    ctx: { operatorId?: string; deviceType?: ContractDeviceType; perspective?: string },
    tx?: Tx,
  ): Promise<boolean> {
    const client = tx ?? db;
    const order = await client.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) return false;
    // 终态（可能已被并发取消）不判
    if (order.status === 'CANCELLED' || order.status === 'COMPLETED') return false;

    // 替换品批1（P1-2 修复，调度拍板方案 a 2026-10-29）：带 PENDING 建议的项不计入全缺判定
    // ——该单不取消，等用户决策（ACCEPTED=替换落单继续履约 / DECLINED=决策端点重判全缺后取消+退款）
    // 或超时 processor 自动拒绝后重判。否则全缺取消会把 PENDING 锁进 CANCELLED，决策窗口
    // 409 + processor 候选过滤排除 → 该缺货量退款永不发生（死锁）。
    const hasPendingSuggestion = order.items.some((i) => i.suggestionStatus === 'PENDING');
    const fullyShort =
      order.items.length > 0 &&
      order.items.every((i) => i.outOfStockQty != null && i.outOfStockQty >= i.quantity) &&
      !hasPendingSuggestion;
    if (!fullyShort) return false;

    await this.orderService.cancelOrderInternal(orderId, {
      operatorId: ctx.operatorId,
      deviceType: ctx.deviceType,
      perspective: ctx.perspective,
      reason: 'OUT_OF_STOCK',
    });

    logger.info({
      msg: 'ORDER_CANCELLED_FULL_OUT_OF_STOCK',
      orderId,
      items: order.items.length,
    });
    return true;
  }

  /** 写 OUT_OF_STOCK_REPORTED 事件（metadata 带项级快照，审计用；tx 可选——P2-1 事务内传入） */
  private async writeReportEvent(
    orderId: string,
    payload: {
      itemId: string;
      outOfStockQty: number;
      reason: string;
      source: 'ADMIN' | 'RIDER';
      operatorId?: string;
      deviceType?: ContractDeviceType;
      perspective?: string;
    },
    tx?: Tx,
  ): Promise<void> {
    const client = tx ?? db;
    const order = await client.order.findUnique({ where: { id: orderId }, select: { status: true } });
    // P3-8（审查 20261024）：去掉 as never 类型掩盖——订单由调用链上游保证存在，
    // 此处显式判空抛错替代 `?? null` + `as never`（若上游重构丢失校验，显式失败不静默写 null）
    if (!order) {
      throw new NotFoundException({ code: 'E-ORDER-004', message: `Order not found: ${orderId}` });
    }
    await client.orderEvent.create({
      data: {
        orderId,
        eventType: 'OUT_OF_STOCK_REPORTED',
        // 登记不改变订单状态（缺货是项级事实，D4）：from = to = 当前状态
        fromStatus: order.status,
        toStatus: order.status,
        operatorId: payload.operatorId ?? null,
        deviceType: toPrismaDeviceType(payload.deviceType),
        perspective: payload.perspective ?? null,
        metadata: {
          itemId: payload.itemId,
          outOfStockQty: payload.outOfStockQty,
          reason: payload.reason,
          source: payload.source,
        } as Prisma.InputJsonValue,
      },
    });
  }
}
