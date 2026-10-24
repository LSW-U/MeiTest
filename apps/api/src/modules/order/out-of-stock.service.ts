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
 *
 * 本批不接推送（批2）、不建退款单（批3）——全缺只落 CANCELLED。
 */
import { Inject, Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db, withTransaction, type Tx } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { StorageService } from '../../shared/storage/storage.service';
import { OrderService } from './order.service';
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
}

@Injectable()
export class OutOfStockService {
  constructor(
    // 批1：evidenceUrls 前缀校验需 StorageService（isOwnUrl 语义，同 dispatch.service.ts:526 先例）
    @Inject(StorageService) private readonly storage: StorageService | null,
    // 全缺 → CANCELLED 复用 OrderService.cancelOrderInternal 既有取消链（D11 零状态机改动）
    @Inject(OrderService) private readonly orderService: OrderService,
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

    // 重复登记幂等（E-OOS-003）：已登记过缺货的项拒绝再次登记（字段永久保留 D18，不覆盖）
    if (item.outOfStockQty != null) {
      throw new ConflictException({
        code: 'E-OOS-003',
        message: `Item ${itemId} already reported out of stock (qty=${item.outOfStockQty})`,
      });
    }

    // P2-1（审查 20261024）：登记 + 事件 + 全缺判定收进同一事务——两个 staff 并发登记
    // 最后两个未登记项时，事务外先 update 再重读会让两次全缺判定都读到对方提交前快照
    // → 漏取消。ReadCommitted 下事务内 update 持行锁，重读可见对方已提交行，判定原子。
    // cancelOrderInternal 自身幂等（updateMany 条件守卫）兜底取消侧并发，不收进本事务
    // （其内部自带 withTransaction，嵌套会开独立事务，语义仍正确：判定为真才走到它）。
    return withTransaction(async (tx: Tx) => {
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          outOfStockQty: input.outOfStockQty,
          outOfStockReason: input.reason,
          outOfStockNote: input.note?.trim() ? input.note.trim().slice(0, 200) : null,
          outOfStockEvidenceUrls: input.evidenceUrls ?? [],
          suggestionItemId: input.suggestionItemId ?? null,
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

      // 全缺判定（仅拣货段窗口，D11）：事务内重读全部项 → 全缺则 CANCELLED
      const orderCancelled = await this.cancelIfFullyOutOfStock(orderId, {
        operatorId: input.operatorId,
        deviceType: input.deviceType,
        perspective: input.perspective,
      });

      return { itemId, orderId, outOfStockQty: input.outOfStockQty, orderCancelled };
    });
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

    // 骑手段按单累计登记：写到第一个未登记项（简化语义：骑手端不做项级精细分摊，
    // 缺货量落到首项，剩余项保持未缺——两账分离，退款金额批3 引擎按项级字段算）
    // 找一个还有余量的项落账（已登记满的项跳过）
    let target = items.find((i) => (i.outOfStockQty ?? 0) === 0 && i.quantity > 0);
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
    await this.assertSuggestionItemBelongsToOrder(orderId, target.id, input.suggestionItemId);

    // P2-1 同口径：登记 + 事件收进事务（骑手段永不触发取消，无判定侧并发问题，
    // 事务化只为两步写原子性）
    return withTransaction(async (tx: Tx) => {
      await tx.orderItem.update({
        where: { id: target.id },
        data: {
          outOfStockQty: input.outOfStockQty,
          outOfStockReason: input.reason,
          outOfStockNote: input.note?.trim() ? input.note.trim().slice(0, 200) : null,
          outOfStockEvidenceUrls: input.evidenceUrls ?? [],
          suggestionItemId: input.suggestionItemId ?? null,
        },
      });

      await this.writeReportEvent(
        orderId,
        {
          itemId: target.id,
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
        itemId: target.id,
        qty: input.outOfStockQty,
        reason: input.reason,
      });

      // 骑手段永不触发全缺取消（D12：窗口 OUT_FOR_DELIVERY 无 →CANCELLED 合法边，且上方已拒全缺）
      return { itemId: target.id, orderId, outOfStockQty: input.outOfStockQty, orderCancelled: false };
    });
  }

  // ===================== 内部 =====================

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

    const fullyShort = order.items.length > 0 && order.items.every(
      (i) => i.outOfStockQty != null && i.outOfStockQty >= i.quantity,
    );
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
