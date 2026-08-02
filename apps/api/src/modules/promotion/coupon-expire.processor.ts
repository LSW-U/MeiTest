/**
 * Coupon Expire Processor — UserCoupon 过期扫描（BullMQ WorkerHost）
 *
 * 决策依据：
 *   - 方案 §3.5/§6 决策 4（2026-07-31）：BullMQ 定时任务推进 UNUSED -> EXPIRED（status 准）
 *   - 每 5min 跑一次 expireStaleCoupons（UNUSED + promotion.endAt<now -> EXPIRED）
 *
 * 任务名：
 *   - 'expire-stale'：定时扫描，幂等（updateMany 只影响 UNUSED 行）
 *
 * 容错：单次扫描失败不影响下次（BullMQ attempts + backoff 重试）
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { COUPON_EXPIRE_QUEUE } from '../../shared/queue';
import { logger } from '../../shared/logger/logger';
import { PromotionService } from './promotion.service';

export interface CouponExpireJobData {
  /** 占位（repeat job 无业务参数）；预留手动触发用 */
  dryRun?: boolean;
}

export interface CouponExpireJobResult {
  expired: number;
  dryRun: boolean;
}

@Processor(COUPON_EXPIRE_QUEUE, { concurrency: 1 })
export class CouponExpireProcessor extends WorkerHost {
  constructor(private readonly promotionService: PromotionService) {
    super();
  }

  async process(
    job: Job<CouponExpireJobData, CouponExpireJobResult>,
  ): Promise<CouponExpireJobResult> {
    if (job.name === 'expire-stale') {
      const dryRun = job.data?.dryRun === true;
      if (dryRun) {
        logger.info({ msg: 'coupon_expire_dry_run_skip' });
        return { expired: 0, dryRun: true };
      }
      const result = await this.promotionService.expireStaleCoupons();
      logger.info({
        msg: 'coupon_expire_done',
        expired: result.expired,
      });
      return { expired: result.expired, dryRun: false };
    }
    logger.warn({ msg: 'coupon_expire_unknown_job', jobName: job.name });
    return { expired: 0, dryRun: false };
  }
}
