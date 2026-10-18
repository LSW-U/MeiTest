/**
 * Admin Behavior Insight Controller — 批5 洞察端点（D5 漏斗 / A7 搜索明细，2026-10-18）
 *
 * 方案：方案v2 §三 批5 · 5；A7 并入单客 360 走 profile 端点扩展（admin-profile.controller
 * 的 getProfile360 追加 searchHistory + churn 字段，本 controller 只放独立查询端点）。
 *
 * 路由：/api/v1/admin/marketing/behavior（与 segment 的 /admin/marketing 同域）
 * 门控：@Roles('SUPER_ADMIN')
 */
import { Controller, Get, Query, Param, BadRequestException, PipeTransform, Inject } from '@nestjs/common';
import { z } from 'zod';
import { BehaviorInsightService } from './behavior-insight.service';
import { Roles } from '../../shared/decorators/roles.decorator';

/** 显式 DI token（tsx 不 emit 装饰器元数据——本仓红线，两端逐字一致） */
export const BEHAVIOR_INSIGHT_TOKEN = 'BehaviorInsightServiceToken';

const FunnelQuery = z.object({
  /** 漏斗窗口（天，1-90，默认 30） */
  days: z.coerce.number().int().min(1).max(90).optional(),
  /** top N 词（1-100，默认 20） */
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const UserSearchQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** 局部 zod query pipe（@Query 恒 string，coerce 后校验；非法 400） */
class ZodQueryPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodTypeAny) {}
  transform(value: unknown): unknown {
    const parsed = this.schema.safeParse(value ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'E-BEHAVIOR-002',
        message: parsed.error.issues[0]?.message ?? 'invalid query',
      });
    }
    return parsed.data;
  }
}

@Controller('api/v1/admin/marketing/behavior')
@Roles('SUPER_ADMIN')
export class AdminBehaviorController {
  constructor(
    @Inject(BEHAVIOR_INSIGHT_TOKEN) private readonly insight: BehaviorInsightService,
  ) {}

  /** GET /admin/marketing/behavior/search-funnel - D5 搜索-成交漏斗（三源对账） */
  @Get('search-funnel')
  async searchFunnel(
    @Query(new ZodQueryPipe(FunnelQuery)) q: z.infer<typeof FunnelQuery>,
  ) {
    const data = await this.insight.getSearchFunnel(q.days ?? 30, q.limit ?? 20);
    return { success: true as const, data };
  }

  /** GET /admin/marketing/behavior/users/:id/searches - A7 per-user 搜索明细 */
  @Get('users/:id/searches')
  async userSearches(
    @Param('id') id: string,
    @Query(new ZodQueryPipe(UserSearchQuery)) q: z.infer<typeof UserSearchQuery>,
  ) {
    const data = await this.insight.getUserSearchHistory(id, q.limit ?? 50);
    return { success: true as const, data };
  }
}
