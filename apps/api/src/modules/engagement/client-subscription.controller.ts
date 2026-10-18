/**
 * Client Subscription Controller — B2 补货提醒手工订阅（批4，2026-10-18）
 *
 * 路由前缀 /api/v1/client/subscriptions（deviceType=client_app，role=customer）
 *
 * 端点：
 *   POST   /        创建/更新订阅（同 productId upsert）
 *   GET    /        我的订阅列表
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

  /** 创建/更新订阅（同 productId upsert；重订阅恢复 enabled） */
  @Post()
  async subscribe(
    @Body(new ZodValidationPipe(CreateSubscriptionRequest)) body: z.infer<typeof CreateSubscriptionRequest>,
    @Req() req: RequestWithUser,
  ) {
    const user = this.requireUser(req);
    const data = await db.clientSubscription.upsert({
      where: { userId_productId: { userId: user.sub, productId: body.productId } },
      create: { userId: user.sub, productId: body.productId, cycleDays: body.cycleDays, enabled: true },
      update: { cycleDays: body.cycleDays, enabled: true },
    });
    return { success: true as const, data };
  }

  /** 我的订阅列表 */
  @Get()
  async listMine(@Req() req: RequestWithUser) {
    const user = this.requireUser(req);
    const items = await db.clientSubscription.findMany({
      where: { userId: user.sub },
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
