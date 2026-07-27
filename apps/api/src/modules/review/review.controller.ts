/**
 * Review Controller — 客户端评论路由（reviews-2）
 *
 * 路由前缀 /api/v1/client（deviceType=client_app，role=customer）
 *
 * 端点：
 *   POST  /orders/:id/review          提交订单/商品评论（rating+content+images+category+productId?）
 *   POST  /orders/:id/rider-review    提交骑手评价（rating+tags+comment?）
 *   GET   /products/:id/reviews       商品评论列表（商品详情页，仅 APPROVED）
 *   GET   /orders/:id/rider-review    订单的骑手评价（订单详情展示）
 *
 * 设计：
 *   - 全局 APP_GUARD 三道闸门 + DeviceTypeGuard 已检查 role/deviceType
 *   - audit 走 @Audit 装饰器（AuditInterceptor 读 metadata 写 AuditLog）
 *   - 错误码 E-REVIEW-001~005（service 抛，filter 自动本地化）
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { z } from 'zod';
import { CreateReviewRequest, CreateRiderReviewRequest } from '@meimart/api-contract';
import { ReviewService } from './review.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';
import type {
  CreateReviewInput,
  CreateRiderReviewInput,
  ReviewCategoryValue,
} from './review.types';

const ListProductReviewsQuery = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

interface RequestWithUser {
  user?: RequestUser;
  headers: Record<string, string | string[] | undefined>;
}

@Controller('api/v1/client')
@Roles('CUSTOMER')
export class ReviewController {
  constructor(@Inject(ReviewService) private readonly reviewService: ReviewService) {}

  /** 提交订单/商品评论 */
  @Post('orders/:id/review')
  @Audit({ resource: 'Review', resourceIdParam: 'id' })
  async createReview(
    @Param('id') orderId: string,
    @Body(new ZodValidationPipe(CreateReviewRequest)) body: z.infer<typeof CreateReviewRequest>,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const input: CreateReviewInput = {
      userId: user.sub,
      orderId,
      rating: body.rating,
      content: body.content,
      images: body.images,
      category: body.category as ReviewCategoryValue,
      productId: body.productId,
    };
    const review = await this.reviewService.createReview(input);
    return { success: true as const, data: review };
  }

  /** 提交骑手评价 */
  @Post('orders/:id/rider-review')
  @Audit({ resource: 'RiderReview', resourceIdParam: 'id' })
  async createRiderReview(
    @Param('id') orderId: string,
    @Body(new ZodValidationPipe(CreateRiderReviewRequest)) body: z.infer<typeof CreateRiderReviewRequest>,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const input: CreateRiderReviewInput = {
      userId: user.sub,
      orderId,
      rating: body.rating,
      tags: body.tags,
      comment: body.comment,
    };
    const review = await this.reviewService.createRiderReview(input);
    return { success: true as const, data: review };
  }

  /** 商品评论列表（C 端商品详情页，仅 APPROVED） */
  @Get('products/:id/reviews')
  async listProductReviews(
    @Param('id') productId: string,
    @Query(new ZodValidationPipe(ListProductReviewsQuery)) query: z.infer<typeof ListProductReviewsQuery>,
  ) {
    const result = await this.reviewService.listProductReviews(productId, {
      cursor: query.cursor,
      limit: query.limit,
    });
    return { success: true as const, data: result };
  }

  /** 订单的骑手评价（C 端订单详情展示） */
  @Get('orders/:id/rider-review')
  async getRiderReview(@Param('id') orderId: string) {
    const review = await this.reviewService.getRiderReviewByOrder(orderId);
    return { success: true as const, data: review };
  }
}
