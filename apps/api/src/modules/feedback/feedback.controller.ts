/**
 * Feedback Controller — 客户端反馈路由（P22 F1，2026-08-19）
 *
 * 路由前缀 /api/v1/client（deviceType=client_app，role=CUSTOMER）
 *
 * 端点：
 *   POST  /feedback          提交反馈（category+content+contact?+images[]）
 *
 * 设计：
 *   - 全局 APP_GUARD 三道闸门 + DeviceTypeGuard 已检查 role/deviceType
 *   - 限流：user 5 次/小时（防刷）+ ip 20 次/小时（多账号兜底）
 *   - audit 走 @Audit 装饰器（maskFields 同 review：content/contact 是用户输入）
 *   - 错误码 E-FEEDBACK-001（service 抛，filter 自动本地化）
 */
import {
  Controller,
  Post,
  Body,
  Req,
  HttpException,
  HttpStatus,
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
import type { FeedbackCategoryValue } from './feedback.types';

interface RequestWithUser {
  user?: RequestUser;
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
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const feedback = await this.feedbackService.createFeedback({
      userId: user.sub,
      category: body.category as FeedbackCategoryValue,
      content: body.content,
      contact: body.contact,
      images: body.images,
    });
    return { success: true as const, data: feedback };
  }
}
