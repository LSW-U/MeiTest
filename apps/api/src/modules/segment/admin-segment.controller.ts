/**
 * Admin Segment Controller — 分层运营端点（客户画像批2 2026-10-18）
 *
 * 方案：方案v2 §三 批2（D2 D3 D4 D7 + C5）+ R-f
 *
 * 路由前缀 /api/v1/admin/marketing/segments（独立前缀，与 /admin/users 不冲突）
 *
 * 门控：全类 @Roles('SUPER_ADMIN')（R-f：分层运营含批量触达，收紧到超管）。
 * 审计：写方法（grant / rules CRUD）由 AuditInterceptor 自动覆盖；
 *       导出（GET）在 controller 内显式写审计（对齐批1 查看即审计 G6 范式——
 *       导出名单是敏感行为，"谁导了哪层"必须留痕）。
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
  Res,
  Inject,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { SegmentService } from './segment.service';
import {
  getSegmentBatchGrantConfig,
  resetSegmentConfigCacheForTest,
} from './segment.config';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { rateLimit } from '../../shared/cache';
import { detectLanguage } from '@meimart/shared-utils';
import type { RequestUser } from '../auth/strategies/jwt.strategy';
import type { LifecycleStage } from '../profile/lifecycle';

const STAGES = ['NEW', 'FIRST_PURCHASE', 'ACTIVE', 'SLEEPING', 'CHURNED'] as const;
const StageParam = z.enum(STAGES);

const CoPurchaseQuery = z.object({
  productId: z.string().min(1),
  lang: z.enum(['en', 'id', 'zh', 'pt', 'tet']).optional(),
});

const ExportQuery = z.object({
  stage: StageParam,
  lang: z.enum(['en', 'id', 'zh', 'pt', 'tet']).optional(),
});

const GrantCouponsRequest = z.object({
  promotionId: z.string().min(1),
  /** 目标用户 id 列表（上限对齐 service 硬顶 5000；更小的 batchLimit 仍由 service 按 G5 校验） */
  userIds: z.array(z.string().min(1)).min(1).max(5000),
});

const CreateRuleRequest = z.object({
  stage: StageParam,
  promotionId: z.string().min(1),
  enabled: z.boolean().optional(),
});

const UpdateRuleRequest = z.object({
  stage: StageParam.optional(),
  promotionId: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

interface ReqWithUser {
  user: RequestUser;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}

@Controller('api/v1/admin/marketing/segments')
@Roles('SUPER_ADMIN')
export class AdminSegmentController {
  constructor(@Inject(SegmentService) private readonly segment: SegmentService) {}

  /** D2 看板：各层人数 / GMV / 占比（G5 阈值同源，与单客页对账一致） */
  @Get('dashboard')
  async dashboard() {
    const data = await this.segment.getSegmentDashboard();
    return { success: true as const, data };
  }

  /** D3 交叉分析：买 X 还买 Y（OrderItem 共现统计，SQL 聚合非算法） */
  @Get('co-purchase')
  async coPurchase(
    @Query(new ZodValidationPipe(CoPurchaseQuery)) query: z.infer<typeof CoPurchaseQuery>,
  ) {
    const data = await this.segment.getCoPurchase(
      query.productId,
      query.lang ?? 'en',
    );
    return { success: true as const, data };
  }

  /** D3 分层回购率（口径：聚合基数 F≥2 占比，G5 同源归层） */
  @Get('repurchase')
  async repurchase() {
    const data = await this.segment.getSegmentRepurchase();
    return { success: true as const, data };
  }

  /**
   * D4 券归因：按层拆解领取/核销/复购增量
   * 口径：claimed=持有该券人数；redeemed=USED 人数；redeemRate=redeemed/claimed；
   *       repurchaseOrders=领券用户 receivedAt 后 30 天内实付订单数（COMPLETED+CANCELLED 口径）。
   */
  @Get('coupon-attribution/:promotionId')
  async couponAttribution(@Param('promotionId') promotionId: string) {
    const data = await this.segment.getCouponAttribution(promotionId);
    return { success: true as const, data };
  }

  /** D7 导出名单 CSV（查看即审计：导出行为落 AuditLog EXPORT_SEGMENT_USERS） */
  @Get('export')
  async exportCsv(
    @Query(new ZodValidationPipe(ExportQuery)) query: z.infer<typeof ExportQuery>,
    @Req() req: ReqWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const lang = query.lang ?? detectLanguage(
      typeof req.headers['accept-language'] === 'string' ? req.headers['accept-language'] : undefined,
    );
    // D7/P2-4：导出即审计（GET 不走 AuditInterceptor，显式写）。放在 CSV 生成之前：
    // 生成抛 500 也已留痕（谁在何时试图导哪一层），成功路径必落审计；写失败不阻塞导出。
    const auditWrite = db.auditLog
      .create({
        data: {
          userId: req.user.sub,
          action: 'EXPORT_SEGMENT_USERS',
          resourceType: 'CustomerSegment',
          resourceId: query.stage,
          deviceType: 'ADMIN_WEB',
          perspective:
            typeof req.headers['x-perspective'] === 'string' ? req.headers['x-perspective'] : null,
          ip: req.ip ?? null,
          userAgent:
            typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
        },
      })
      .catch((e: unknown) => {
        logger.warn({
          msg: 'segment_export_audit_write_failed',
          err: e instanceof Error ? e.message : String(e),
        });
      });
    const csv = await this.segment.exportSegmentCsv(query.stage, lang);
    // 导出成功路径先等审计落定（失败已被 catch 吞掉不影响返回）
    await auditWrite;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="segment-${query.stage.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return csv;
  }

  /**
   * D7 批量发券（v2 订正 #7 新建；R-f：SUPER_ADMIN + 频控 + 单批上限 + 幂等）
   *
   * 幂等：UserCoupon @@unique([userId, promotionId])，撞约束跳过不报错（granted/skipped 分账）。
   * 频控：Redis 滑动窗口（rateLimitPerMinute 可配，默认 1 次/分钟）。
   */
  @Post('coupons/grant')
  @Audit({ resource: 'UserCoupon' })
  async grantCoupons(
    @Body(new ZodValidationPipe(GrantCouponsRequest)) body: z.infer<typeof GrantCouponsRequest>,
    @Req() req: ReqWithUser,
  ) {
    // 频控（R-f）：配置可调（G5），默认 1 次/分钟
    const cfg = await getSegmentBatchGrantConfig();
    const rl = await rateLimit('segment:grant:endpoint', cfg.rateLimitPerMinute, 60);
    if (!rl.allowed) {
      throw new HttpException(
        { code: 'E-SEGMENT-003', message: `Rate limited, retry after ${rl.retryAfter}s` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const data = await this.segment.batchGrantCoupons(
      body.promotionId,
      body.userIds,
      req.user.sub,
    );
    return { success: true as const, data };
  }

  // ===== C5 分层定向券规则 CRUD =====

  @Get('coupon-rules')
  async listRules() {
    const data = await this.segment.listRules();
    return { success: true as const, data };
  }

  @Post('coupon-rules')
  @Audit({ resource: 'SegmentCouponRule' })
  async createRule(
    @Body(new ZodValidationPipe(CreateRuleRequest)) body: z.infer<typeof CreateRuleRequest>,
  ) {
    const data = await db.segmentCouponRule.create({
      data: { stage: body.stage, promotionId: body.promotionId, enabled: body.enabled ?? true },
      include: { promotion: { select: { id: true, code: true, name: true, status: true } } },
    });
    return { success: true as const, data };
  }

  @Patch('coupon-rules/:id')
  @Audit({ resource: 'SegmentCouponRule', resourceIdParam: 'id' })
  async updateRule(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateRuleRequest)) body: z.infer<typeof UpdateRuleRequest>,
  ) {
    const data = await db.segmentCouponRule
      .update({
        where: { id },
        data: {
          ...(body.stage !== undefined ? { stage: body.stage } : {}),
          ...(body.promotionId !== undefined ? { promotionId: body.promotionId } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        },
        include: { promotion: { select: { id: true, code: true, name: true, status: true } } },
      })
      .catch(() => {
        throw new HttpException(
          { code: 'E-SEGMENT-001', message: 'Segment coupon rule not found' },
          HttpStatus.NOT_FOUND,
        );
      });
    return { success: true as const, data };
  }

  @Delete('coupon-rules/:id')
  @Audit({ resource: 'SegmentCouponRule', resourceIdParam: 'id' })
  async deleteRule(@Param('id') id: string) {
    const data = await db.segmentCouponRule
      .delete({ where: { id }, select: { id: true } })
      .catch(() => {
        throw new HttpException(
          { code: 'E-SEGMENT-001', message: 'Segment coupon rule not found' },
          HttpStatus.NOT_FOUND,
        );
      });
    return { success: true as const, data };
  }

  /** 批4 预留：按层解析生效规则（C5 与自动化流共用） */
  @Get('coupon-rules/resolve')
  async resolveRules(@Query('stage') stage: string) {
    const parsed = StageParam.safeParse(stage);
    if (!parsed.success) {
      throw new HttpException(
        { code: 'E-SEGMENT-004', message: `Invalid stage: ${stage}` },
        HttpStatus.BAD_REQUEST,
      );
    }
    const data = await this.segment.resolveRulesForStage(parsed.data as LifecycleStage);
    return { success: true as const, data };
  }
}

// 单测用：暴露缓存重置（与 segment.config 同步导出）
export { resetSegmentConfigCacheForTest };
