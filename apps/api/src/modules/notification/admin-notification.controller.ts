/**
 * Admin Notification Controller — 后台通知/推送管理路由（admin-web 优化方案 批次2 2026-08-29）
 *
 * 路由前缀 /api/v1/admin/notifications（deviceType=admin_web，role=SUPER_ADMIN）
 *
 * 端点：
 *   POST  /          发送通知（target=ALL_CUSTOMERS/ALL_RIDERS/SPECIFIC_USERS + type + 多语言 title/content）
 *   GET   /          发送历史列表（offset 分页 + type/target 筛选）
 *
 * 设计：
 *   - 全局 APP_GUARD 四道闸门（Jwt → DeviceType → Roles → RateLimit）已检查 role/deviceType
 *   - POST 走 @Audit（写操作记审计）；GET 不走 @Audit（只读浏览不记审计）
 *   - MVP 真链路 = 写 Notification 表 + 前端拉取；PUSH 是 dev stub（mockFlag=true 提示未真实推送）
 *   - 错误码 E-ADMIN-NOTIF-001/002（service 抛，filter 自动本地化）+ E-COMMON-001（zod pipe 抛）
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Inject,
} from '@nestjs/common';
import { z } from 'zod';
import {
  AdminSendNotificationRequest,
  AdminListNotificationsQuery,
} from '@meimart/api-contract';
import { AdminNotificationService } from './admin-notification.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';

@Controller('api/v1/admin/notifications')
@Roles('SUPER_ADMIN')
export class AdminNotificationController {
  constructor(
    @Inject(AdminNotificationService)
    private readonly notifService: AdminNotificationService,
  ) {}

  /** 发送通知（群发/指定，多语言 title/content） */
  @Post()
  @Audit({ resource: 'Notification', maskFields: ['content'] })
  async send(
    @Body(new ZodValidationPipe(AdminSendNotificationRequest))
    body: z.infer<typeof AdminSendNotificationRequest>,
  ) {
    const data = await this.notifService.send(body);
    return { success: true as const, data };
  }

  /** 发送历史列表（offset 分页 + type 筛选；MVP 不支持 target 筛选，见 service 注释） */
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
}
