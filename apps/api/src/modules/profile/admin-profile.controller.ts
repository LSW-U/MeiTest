/**
 * Admin Customer Profile Controller — 单客 360 背调端点（客户画像批1 2026-10-18）
 *
 * 方案：方案v2 §三 批1 + G6（查看即审计）+ G7（挂 /admin/users 旁）
 *
 * 路由前缀 /api/v1/admin/users（与 admin-user.controller 同前缀——DeviceTypeGuard
 * 按 URL 前缀 /api/v1/admin 强制 admin_web token，client token 不可达）
 *
 * 路由冲突说明：admin-user.controller 的 GET /:id 在前注册，GET /:id/profile /
 * GET /:id/notes 等更长路径不与其匹配（Nest 路由按声明顺序精确匹配，/:id 不会吞掉
 * /:id/profile 两段路径）。
 *
 * 审计（G6）：查看即审计。AuditInterceptor 只审计写方法（GET 跳过），因此画像查看
 * 在 controller 内显式写 AuditLog（action=VIEW_CUSTOMER_PROFILE，resourceType=CustomerProfile，
 * resourceId=目标用户 id）——审计记录"谁在何时看了谁"。写操作（notes CRUD）走
 * AuditInterceptor 自动审计（POST/PATCH/DELETE 默认审计）。
 *
 * 门控：@Roles('SUPER_ADMIN')（roles.guard，非 admin 403 E-AUTH-010）
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  Inject,
} from '@nestjs/common';
import { z } from 'zod';
import { ProfileService } from './profile.service';
import { CustomerNoteService } from './customer-note.service';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { detectLanguage } from '@meimart/shared-utils';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

const CreateNoteRequest = z.object({
  /** 标记类型（自由标签，如 VIP / RISK / COMPLAINT） */
  type: z.string().min(1).max(30),
  content: z.string().min(1).max(500),
});

const UpdateNoteRequest = z.object({
  type: z.string().min(1).max(30).optional(),
  content: z.string().min(1).max(500).optional(),
});

@Controller('api/v1/admin/users')
@Roles('SUPER_ADMIN')
export class AdminProfileController {
  constructor(
    @Inject(ProfileService) private readonly profile: ProfileService,
    @Inject(CustomerNoteService) private readonly notes: CustomerNoteService,
  ) {}

  /** GET /:id/profile - 单客 360 画像（查看即审计 G6） */
  @Get(':id/profile')
  async getProfile360(
    @Req()
    req: {
      user: RequestUser;
      headers: Record<string, string | string[] | undefined>;
      ip?: string;
    },
    @Param('id') id: string,
  ) {
    const lang = detectLanguage(
      typeof req.headers['accept-language'] === 'string'
        ? req.headers['accept-language']
        : undefined,
    );
    const data = await this.profile.getCustomerProfile360(id, lang);
    // G6 查看即审计：AuditInterceptor 跳过 GET，这里显式写（异步不阻塞响应）
    db.auditLog
      .create({
        data: {
          userId: req.user.sub,
          action: 'VIEW_CUSTOMER_PROFILE',
          resourceType: 'CustomerProfile',
          resourceId: id,
          deviceType: 'ADMIN_WEB',
          perspective:
            typeof req.headers['x-perspective'] === 'string'
              ? req.headers['x-perspective']
              : null,
          ip: typeof req.ip === 'string' ? req.ip.slice(0, 50) : null,
          userAgent:
            typeof req.headers['user-agent'] === 'string'
              ? req.headers['user-agent'].slice(0, 500)
              : null,
        },
      })
      .catch((e: unknown) => {
        // 审计失败不阻塞查看（与 AuditInterceptor tap catch 同语义），只告警
        logger.warn({
          msg: 'profile_view_audit_write_failed',
          error: e instanceof Error ? e.message : String(e),
          targetUserId: id,
        });
      });
    return { success: true as const, data };
  }

  /** GET /:id/notes - 客户标记列表 */
  @Get(':id/notes')
  async listNotes(@Param('id') id: string) {
    const data = await this.notes.list(id);
    return { success: true as const, data };
  }

  /** POST /:id/notes - 新增标记（写审计由 AuditInterceptor 自动覆盖 POST） */
  @Post(':id/notes')
  @Audit({ resource: 'CustomerNote', resourceIdParam: 'id' })
  async createNote(
    @Req() req: { user: RequestUser },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateNoteRequest)) body: z.infer<typeof CreateNoteRequest>,
  ) {
    const data = await this.notes.create(id, body, req.user.sub);
    return { success: true as const, data };
  }

  /** PATCH /:id/notes/:noteId - 编辑标记 */
  @Patch(':id/notes/:noteId')
  @Audit({ resource: 'CustomerNote', resourceIdParam: 'noteId' })
  async updateNote(
    @Req() req: { user: RequestUser },
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @Body(new ZodValidationPipe(UpdateNoteRequest)) body: z.infer<typeof UpdateNoteRequest>,
  ) {
    const data = await this.notes.update(id, noteId, body, req.user.sub);
    return { success: true as const, data };
  }

  /** DELETE /:id/notes/:noteId - 删除标记 */
  @Delete(':id/notes/:noteId')
  @Audit({ resource: 'CustomerNote', resourceIdParam: 'noteId' })
  async deleteNote(
    @Req() req: { user: RequestUser },
    @Param('id') id: string,
    @Param('noteId') noteId: string,
  ) {
    const data = await this.notes.remove(id, noteId, req.user.sub);
    return { success: true as const, data };
  }
}
