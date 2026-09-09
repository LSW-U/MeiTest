/**
 * Admin Notification Controller — 后台通知/推送管理路由（admin-web 优化方案 批次2 2026-08-29）
 *
 * 批A A5 批次化（2026-09-09）：
 *   POST /          发送通知（批次化：写 Batch 行 + 首块同步 + 剩余 BullMQ 异步）
 *   GET   /         发送历史列表（批次行倒序，target/totalRecipients 真实值）
 *   POST /:batchId/retry  失败重试（仅重发 failed 用户，批A A5 新增）
 *
 * 设计：
 *   - 全局 APP_GUARD 四道闸门（Jwt → DeviceType → Roles → RateLimit）已检查 role/deviceType
 *   - POST 走 @Audit（写操作记审计）；GET 不走 @Audit（只读浏览不记审计）
 *   - 错误码 E-ADMIN-NOTIF-001/002/003（service 抛）+ E-COMMON-001（zod pipe 抛）
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Req,
  Inject,
} from '@nestjs/common';
import { z } from 'zod';
import {
  AdminSendNotificationRequest,
  AdminListNotificationsQuery,
} from '@meimart/api-contract';
import type { RequestUser } from '../auth/strategies/jwt.strategy';
import { AdminNotificationService } from './admin-notification.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';

interface RequestWithUser {
  user?: RequestUser;
  headers: Record<string, string | string[] | undefined>;
}

@Controller('api/v1/admin/notifications')
@Roles('SUPER_ADMIN')
export class AdminNotificationController {
  constructor(
    @Inject(AdminNotificationService)
    private readonly notifService: AdminNotificationService,
  ) {}

  /** 发送通知（群发/指定，多语言 title/content；批次化写 NotificationBatch） */
  @Post()
  @Audit({ resource: 'Notification', maskFields: ['content'] })
  async send(
    @Req() req: RequestWithUser,
    @Body(new ZodValidationPipe(AdminSendNotificationRequest))
    body: z.infer<typeof AdminSendNotificationRequest>,
  ) {
    if (!req.user) {
      // JwtGuard 后 req.user 必在（防御式）
      throw new Error('Unauthorized');
    }
    const data = await this.notifService.send(body, req.user.sub);
    return { success: true as const, data };
  }

  /** 发送历史列表（批次行倒序 + type 筛选） */
  @Get()
  async list(
    @Query(new ZodValidationPipe(AdminListNotificationsQuery))
    query: z.infer<typeof AdminListNotificationsQuery>,
  ) {
    const data = await this.notifService.listHistory({
      type: query.type,
      page: query.page,
      pageSize: query.pageSize,
    });
    return { success: true as const, data };
  }

  /** 失败重试（仅重发 failed 用户，批A A5） */
  @Post(':batchId/retry')
  @Audit({ resource: 'Notification', maskFields: [] })
  async retry(@Param('batchId') batchId: string) {
    const data = await this.notifService.retry(batchId);
    return { success: true as const, data };
  }
}
