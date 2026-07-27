/**
 * Admin Review Controller — 后台评论管理路由（reviews-2）
 *
 * 路由前缀 /api/v1/admin/reviews（deviceType=admin_web，role=super_admin/warehouse_staff/customer_service）
 *
 * 端点：
 *   GET    /            列表（?type=customer|rider + category/status/rating/keyword 筛选 + 分页）
 *   GET    /:id         详情（?type=customer|rider）
 *   PATCH  /:id         审核 status + 商家回复 reply（?type 区分表）
 *   DELETE /:id         硬删（决策4，?type 区分表）
 *
 * type 通过 query 传入区分客户评论（reviews 表）/ 骑手评价（rider_reviews 表）。
 */
import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminListReviewsQuery, AdminUpdateReviewRequest } from '@meimart/api-contract';
import { ReviewService } from './review.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';
import type {
  ReviewType,
  ReviewStatusValue,
  ReviewCategoryValue,
  AdminUpdateReviewInput,
} from './review.types';

interface RequestWithUser {
  user?: RequestUser;
  headers: Record<string, string | string[] | undefined>;
}

/** query.type 字符串 → ReviewType（默认 customer） */
function parseType(t: string | undefined): ReviewType {
  return t === 'rider' ? 'rider' : 'customer';
}

@Controller('api/v1/admin/reviews')
@Roles('SUPER_ADMIN', 'WAREHOUSE_STAFF', 'CUSTOMER_SERVICE')
export class AdminReviewController {
  constructor(@Inject(ReviewService) private readonly reviewService: ReviewService) {}

  /** 列表（type=customer|rider + 多维筛选 + 游标分页） */
  @Get()
  async list(
    @Query(new ZodValidationPipe(AdminListReviewsQuery)) query: z.infer<typeof AdminListReviewsQuery>,
  ) {
    const result = await this.reviewService.adminListReviews({
      type: query.type as ReviewType,
      category: query.category as ReviewCategoryValue | undefined,
      status: query.status as ReviewStatusValue | undefined,
      rating: query.rating,
      keyword: query.keyword,
      cursor: query.cursor,
      limit: query.limit,
    });
    return { success: true as const, data: result };
  }

  /** 详情（?type=customer|rider） */
  @Get(':id')
  async detail(@Param('id') id: string, @Query('type') type: string | undefined) {
    const review = await this.reviewService.adminGetReview(id, parseType(type));
    return { success: true as const, data: review };
  }

  /** 审核 status + 商家回复 reply（?type 区分表） */
  @Patch(':id')
  @Audit({ resource: 'Review', resourceIdParam: 'id' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminUpdateReviewRequest)) body: z.infer<typeof AdminUpdateReviewRequest>,
    @Query('type') type: string | undefined,
    @Req() req: RequestWithUser,
  ) {
    if (!req.user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const input: AdminUpdateReviewInput = {
      status: body.status as ReviewStatusValue | undefined,
      reply: body.reply,
    };
    const review = await this.reviewService.adminUpdateReview(id, parseType(type), input);
    return { success: true as const, data: review };
  }

  /** 硬删（决策4，?type 区分表） */
  @Delete(':id')
  @Audit({ resource: 'Review', resourceIdParam: 'id' })
  async remove(@Param('id') id: string, @Query('type') type: string | undefined) {
    await this.reviewService.adminDeleteReview(id, parseType(type));
    return { success: true as const, data: { id } };
  }
}
