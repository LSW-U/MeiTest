/**
 * Rider Order History Controller — 骑手订单历史（方案v2-20261009，R12 互斥口径）
 *
 * 路径：
 *   GET /api/v1/rider/orders/history              历史列表（批1 P1：三态全查 + 派生后过滤 + offset 分页）
 *   GET /api/v1/rider/orders/stats/today          今日统计（批1 P1：Dili 当日只算 completed）
 *   GET /api/v1/rider/orders/stats/status-counts  状态计数（批2 P2：R12 互斥口径四值）
 *   GET /api/v1/rider/orders/:id                  历史订单详情（批2 P2：delivery task id）
 *
 * 鉴权：@Roles('RIDER') 类级 + req.user.sub（earnings.controller.ts:37-38 先例，方法级不重复标）。
 * 路由顺序：/history 与 /stats/* 注册在 /:id 之前（Nest 按声明顺序匹配，防静态段被 :id 吞）。
 */
import { Controller, Get, Param, ParseUUIDPipe, Query, Request, Inject } from '@nestjs/common';
import { RiderOrderHistoryService } from './order-history.service';
import { Roles } from '../../shared/decorators/roles.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import type { RequestUser } from '../auth/strategies/jwt.strategy';
import {
  RiderOrderHistoryQuery,
  type RiderOrderHistoryQueryType,
} from '@meimart/api-contract';

@Controller('api/v1/rider/orders')
@Roles('RIDER')
export class RiderOrderHistoryController {
  constructor(
    @Inject(RiderOrderHistoryService) private readonly history: RiderOrderHistoryService,
  ) {}

  /** 历史订单列表（批1：R12 三态全查，status 过滤在派生映射后做，offset 分页） */
  @Get('history')
  async historyList(
    @Query(new ZodValidationPipe(RiderOrderHistoryQuery)) query: unknown,
    @Request() req: { user: RequestUser },
  ) {
    const data = await this.history.getHistory(
      req.user.sub,
      query as RiderOrderHistoryQueryType,
    );
    return { success: true as const, data };
  }

  /** 今日统计（批1：count 与 totalIncome 同口径只算 completed，Dili 当日） */
  @Get('stats/today')
  async todayStats(@Request() req: { user: RequestUser }) {
    const data = await this.history.getTodayStats(req.user.sub);
    return { success: true as const, data };
  }

  /** 状态计数（批2，R12 互斥：all = completed + cancelled + transferred） */
  @Get('stats/status-counts')
  async statusCounts(@Request() req: { user: RequestUser }) {
    const data = await this.history.getStatusCounts(req.user.sub);
    return { success: true as const, data };
  }

  /** 历史订单详情（批2：delivery task id；非本人/非历史范围 → 404 E-RIDER-001） */
  @Get(':id')
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Request() req: { user: RequestUser },
  ) {
    const data = await this.history.getDetail(req.user.sub, id);
    return { success: true as const, data };
  }
}
