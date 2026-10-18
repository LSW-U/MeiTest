/**
 * Client Subscription Controller — B2 补货提醒手工订阅（批4，2026-10-18）
 *
 * 路由前缀 /api/v1/client/subscriptions（deviceType=client_app，role=customer）
 *
 * 端点：
 *   POST   /        创建/更新订阅（同 productId+type upsert；批5 扩展 C7/C8 类型）
 *   GET    /        我的订阅列表（?type= 过滤）
 *   PATCH  /:id     启停 / 改周期（仅本人）
 *   DELETE /:id     取消订阅（仅本人）
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { z } from 'zod';
import {
  CreateSubscriptionRequest,
  UpdateSubscriptionRequest,
} from '@meimart/api-contract';
import { db } from '../../shared/db';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { isSubscriptionType } from './behavior.config';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

interface RequestWithUser {
  user?: RequestUser;
}

@Controller('api/v1/client/subscriptions')
@Roles('CUSTOMER')
export class ClientSubscriptionController {
  // tsx 无 decorator metadata：本 controller 直用 db，无 service 依赖

  private requireUser(req: RequestWithUser): RequestUser {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    return user;
  }

  /**
   * 创建/更新订阅（同 productId+type upsert；重订阅恢复 enabled）
   *
   * 批5 语义：type=REPLENISH 用 cycleDays；PRICE_ALERT 记 priceAtSub 价格快照
   * （服务端取商品现 priceMin，不信任客户端价）；RESTOCK_ALERT 无附加参数。
   */
  @Post()
  async subscribe(
    @Body(new ZodValidationPipe(CreateSubscriptionRequest)) body: z.infer<typeof CreateSubscriptionRequest>,
    @Req() req: RequestWithUser,
  ) {
    const user = this.requireUser(req);
    const type = body.type ?? 'REPLENISH';
    if (!isSubscriptionType(type)) {
      throw new HttpException({ code: 'E-BEHAVIOR-003', message: 'invalid subscription type' }, HttpStatus.BAD_REQUEST);
    }
    // C7 降价订阅：服务端取现价快照（防客户端伪造高价制造假降幅）
    let priceAtSub: number | undefined;
    if (type === 'PRICE_ALERT') {
      const product = await db.product.findUnique({
        where: { id: body.productId },
        select: { priceMin: true, status: true },
      });
      if (!product || product.status !== 'ACTIVE') {
        throw new HttpException({ code: 'E-BEHAVIOR-004', message: 'product not found' }, HttpStatus.NOT_FOUND);
      }
      priceAtSub = product.priceMin;
    }
    const data = await db.clientSubscription.upsert({
      where: { userId_productId_type: { userId: user.sub, productId: body.productId, type } },
      create: {
        userId: user.sub,
        productId: body.productId,
        type,
        cycleDays: body.cycleDays ?? 30,
        enabled: true,
        ...(type === 'PRICE_ALERT' && priceAtSub != null ? { priceAtSub } : {}),
      },
      update: {
        cycleDays: body.cycleDays ?? undefined,
        enabled: true,
        ...(type === 'PRICE_ALERT' && priceAtSub != null ? { priceAtSub } : {}),
      },
    });
    // P2-1 裁决（批5 审查 2026-10-18）：重订阅=重新要提醒 → 清该用户该商品该类型的旧
    // outreach_triggers 幂等记录（含 C8 上个周期留下的 SENT 行），否则 C8 第二周期被
    // gateAndFire 预检 duplicate 短路、永不触达。C8 无独立 triggerKey 代次（key 固定
    // C8:{subId} 且 upsert 不换 id），清行是唯一无 migration 的代次重置手段。
    await db.outreachTrigger
      .deleteMany({
        where: { userId: user.sub, flow: { in: ['C7', 'C8'] }, triggerKey: { contains: data.id } },
      })
      .catch(() => undefined);
    return { success: true as const, data };
  }

  /** 我的订阅列表（?type= 可选过滤） */
  @Get()
  async listMine(
    @Req() req: RequestWithUser,
    @Query('type') type?: string,
  ) {
    const user = this.requireUser(req);
    if (type !== undefined && !isSubscriptionType(type)) {
      throw new HttpException({ code: 'E-BEHAVIOR-003', message: 'invalid subscription type' }, HttpStatus.BAD_REQUEST);
    }
    const items = await db.clientSubscription.findMany({
      where: { userId: user.sub, ...(type ? { type } : {}) },
      orderBy: { updatedAt: 'desc' },
    });
    return { success: true as const, data: { items } };
  }

  /** 启停 / 改周期（仅本人） */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSubscriptionRequest)) body: z.infer<typeof UpdateSubscriptionRequest>,
    @Req() req: RequestWithUser,
  ) {
    const user = this.requireUser(req);
    const existing = await db.clientSubscription.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.sub) {
      throw new HttpException({ code: 'E-ENGAGE-001', message: 'subscription not found' }, HttpStatus.NOT_FOUND);
    }
    const data = await db.clientSubscription.update({
      where: { id },
      data: {
        cycleDays: body.cycleDays ?? undefined,
        enabled: body.enabled ?? undefined,
      },
    });
    return { success: true as const, data };
  }

  /** 取消订阅（仅本人） */
  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: RequestWithUser) {
    const user = this.requireUser(req);
    const existing = await db.clientSubscription.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.sub) {
      throw new HttpException({ code: 'E-ENGAGE-001', message: 'subscription not found' }, HttpStatus.NOT_FOUND);
    }
    await db.clientSubscription.delete({ where: { id } });
    return { success: true as const, data: { deleted: true } };
  }
}
