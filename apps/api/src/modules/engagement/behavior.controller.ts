/**
 * Behavior Controller — 行为埋点批量接收（批5 G2，2026-10-18）
 *
 * 方案：方案v2 §三 批5 · 1（客户端埋点上报服务端入口）
 *
 * 语义：
 *   - OptionalAuth：匿名可报（带有效 token 自动关联 userId）
 *   - ≤100 条/批（超限 400 E-BEHAVIOR-001）；整批 zod 校验（一条非法整批拒——客户端
 *     批内同构，单条脏数据属上报 bug，拒整批便于暴露）
 *   - **异步写入不阻塞**（fire-and-forget createMany，R-c：失败降级只丢埋点，永远 200）
 *   - 恶意/刷量防护：端点挂 rate-limit.guard（key=behavior:${ip} 滑动窗口 30 次/分）+ 上限截断
 *
 * 幂等说明（P5-1）：埋点是追加型事实流（允许重复=真实行为重复），不做去重键；
 * 服务端 10s 级去重由客户端批量合并承担（前端 hook 职责，方案批5 前端节）。
 */
import { Controller, Post, Body, Req } from '@nestjs/common';
import { z } from 'zod';
import { OptionalAuth } from '../../shared/decorators/optional-auth.decorator';
import { Public } from '../../shared/decorators/public.decorator';
import { RateLimit } from '../../shared/decorators/rate-limit.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { BehaviorBatchRequest } from '@meimart/api-contract';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

/** 单批上限（G2：客户端 hook 攒批 5-10s flush，100 条覆盖高频浏览不溢出；与契约 max 一致，仅作对齐断言用） */
export const BEHAVIOR_BATCH_MAX = 100;

interface RequestWithUser {
  user?: RequestUser;
  ip?: string;
}

@Controller('api/v1/client/behavior-events')
export class BehaviorController {
  @Post()
  // @Public() 只为过 RolesGuard least-privilege 闸（本端点匿名可达是业务语义）；
  // 真正的"可选登录"由 @OptionalAuth 决定：JwtAuthGuard 仍跑 passport 校验，
  // 有效 token 注入 req.user，无/无效 token 降级匿名（注释见批1 OptionalAuth 装饰器）
  @Public()
  @OptionalAuth()
  @RateLimit({ key: 'behavior:${ip}', limit: 30, window: 60 })
  async batchCreate(
    // P3-3（批5 审查）：校验复用契约 BehaviorBatchRequest（消除本地 zod 双份定义漂移），
    // 拒绝码落 E-BEHAVIOR-001（批量超 100）
    @Body(new ZodValidationPipe(BehaviorBatchRequest, 'E-BEHAVIOR-001'))
    body: z.infer<typeof BehaviorBatchRequest>,
    @Req() req: RequestWithUser,
  ) {
    const userId = req.user?.sub ?? null;
    const rows = body.events.map((e) => ({
      userId,
      productId: e.productId,
      type: e.type,
    }));
    // R-c 异步写入不阻塞：createMany 后台跑，失败只丢埋点（logger.warn 留痕），永远同步返回
    void db.behaviorEvent
      .createMany({ data: rows })
      .then((r) => {
        if (r.count !== rows.length) {
          logger.warn({ msg: 'BEHAVIOR_BATCH_PARTIAL', expected: rows.length, written: r.count });
        }
      })
      .catch((err: unknown) => {
        logger.warn({
          msg: 'BEHAVIOR_BATCH_DROPPED',
          count: rows.length,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return { success: true as const, data: { accepted: rows.length } };
  }
}
