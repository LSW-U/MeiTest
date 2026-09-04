/**
 * Feedback Controller — 客户端反馈路由（P22 F1，2026-08-19；F7 修复 2026-08-25）
 *
 * 路由前缀 /api/v1/client（deviceType=client_app，role=CUSTOMER）
 *
 * 端点：
 *   POST  /feedback          提交反馈（category+content+contact?+images[]）
 *
 * 设计：
 *   - 全局 APP_GUARD 四道闸门（Jwt → DeviceType → Roles → RateLimit）已检查 role/deviceType/登录态
 *   - JwtAuthGuard 保证非 @Public 端点 req.user 必有值（F7：移除冗余 if(!user)，guard 已兜底）
 *   - 限流：user 5 次/小时（防刷，${user.sub} 在 RateLimitGuard 阶段已由 Jwt 认证填充）+ ip 20 次/小时
 *   - audit 走 @Audit 装饰器（maskFields 同 review：content/contact 是用户输入）
 *   - 错误码 E-FEEDBACK-001（service 抛，filter 自动本地化）
 */
import {
  Controller,
  Post,
  Body,
  Req,
  Inject,
} from '@nestjs/common';
import { z } from 'zod';
import { CreateFeedbackRequest } from '@meimart/api-contract';
import { FeedbackService } from './feedback.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import { RateLimit } from '../../shared/decorators/rate-limit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

interface RequestWithUser {
  user: RequestUser; // F7：JwtAuthGuard 保证非 @Public 端点 user 必有值
  headers: Record<string, string | string[] | undefined>;
}

@Controller('api/v1/client/feedback')
@Roles('CUSTOMER')
export class FeedbackController {
  constructor(@Inject(FeedbackService) private readonly feedbackService: FeedbackService) {}

  /** 提交反馈 */
  @Post()
  @Audit({ resource: 'Feedback', maskFields: ['content', 'contact', 'images'] })
  @RateLimit(
    { key: 'feedback:user:${user.sub}', limit: 5, window: 3600 },
    { key: 'feedback:ip:${ip}', limit: 20, window: 3600 },
  )
  async create(
    @Body(new ZodValidationPipe(CreateFeedbackRequest)) body: z.infer<typeof CreateFeedbackRequest>,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    // F7：JwtAuthGuard 已保证 user 存在（非 @Public 端点未通过认证会被 guard 拦在 401），无需再判空
    const feedback = await this.feedbackService.createFeedback({
      userId: user.sub,
      // F4：body.category 已由 CreateFeedbackRequest z.enum 校验，类型即 FeedbackCategoryValue
      category: body.category,
      content: body.content,
      contact: body.contact,
      images: body.images,
    });
    return { success: true as const, data: feedback };
  }
}
