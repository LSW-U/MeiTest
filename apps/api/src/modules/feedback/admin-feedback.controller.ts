/**
 * Admin Feedback Controller — 后台反馈管理路由（admin-web 优化方案 批次2 2026-08-29）
 *
 * 路由前缀 /api/v1/admin/feedback（deviceType=admin_web，role=SUPER_ADMIN）
 *
 * 端点（MVP 只读，无 migration）：
 *   GET  /          列表（category 筛选 + 时间范围 + keyword + 分页 + submitter 摘要）
 *   GET  /:id       详情（含 images 截图 URL + submitter 扩展信息）
 *
 * 设计：
 *   - 全局 APP_GUARD 四道闸门（Jwt → DeviceType → Roles → RateLimit）已检查 role/deviceType
 *   - GET 不走 @Audit（AuditInterceptor 只审计写方法；后台只读浏览不记审计日志）
 *   - 错误码 E-FEEDBACK-002（service 抛，filter 自动本地化）
 *   - 处理状态字段为后续增强项（需 migration），MVP 先只读
 */
import {
  Controller,
  Get,
  Param,
  Query,
  Inject,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminListFeedbackQuery } from '@meimart/api-contract';
import { FeedbackService } from './feedback.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';

@Controller('api/v1/admin/feedback')
@Roles('SUPER_ADMIN')
export class AdminFeedbackController {
  constructor(@Inject(FeedbackService) private readonly feedbackService: FeedbackService) {}

  /** 列表（category/keyword/时间范围筛选 + offset 分页 + submitter 摘要） */
  @Get()
  async list(
    @Query(new ZodValidationPipe(AdminListFeedbackQuery)) query: z.infer<typeof AdminListFeedbackQuery>,
  ) {
    const data = await this.feedbackService.adminListFeedback({
      category: query.category,
      keyword: query.keyword,
      startDate: query.startDate,
      endDate: query.endDate,
      page: query.page,
      pageSize: query.pageSize,
    });
    return { success: true as const, data };
  }

  /** 详情（含 images 截图 URL + submitter 扩展信息） */
  @Get(':id')
  async detail(@Param('id') id: string) {
    const data = await this.feedbackService.adminGetFeedback(id);
    return { success: true as const, data };
  }
}
