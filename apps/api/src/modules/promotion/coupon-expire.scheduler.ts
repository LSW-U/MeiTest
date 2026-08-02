/**
 * Coupon Expire Scheduler — UserCoupon 过期定时任务注册（BullMQ repeatable job）
 *
 * 设计要点：
 *   - onModuleInit 时幂等注册 repeatable job（BullMQ 按 repeat pattern + key 去重）
 *   - 多实例部署不重复触发（BullMQ 由 Redis 协调单 worker 拿任务）
 *   - 频率：每 5min（方案 §3.5；MVP 体量下足够，卡包 status 准确性 vs DB 负载的平衡）
 *
 * 决策依据：
 *   - 方案 §6 决策 4（2026-07-31）：定时任务为主，查询兜底（listMyCoupons expired tab 也算 endAt<now）
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { COUPON_EXPIRE_QUEUE } from '../../shared/queue';
import { logger } from '../../shared/logger/logger';
import type { CouponExpireJobData } from './coupon-expire.processor';

/** 重复任务去重 key（BullMQ 用此 key + pattern 判等） */
const COUPON_EXPIRE_REPEAT_KEY = 'coupon-expire-every-5min';

/** 每 5 分钟跑一次（秒位用非整 0/30，避开 fleet 同期撞 API） */
const COUPON_EXPIRE_CRON_PATTERN = '*/5 * * * *';
const COUPON_EXPIRE_CRON_TZ = 'Asia/Dili';

/** 手动触发时用的 job name（与定时任务同 processor 处理） */
export const COUPON_EXPIRE_JOB_RUN = 'expire-stale';

@Injectable()
export class CouponExpireScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(COUPON_EXPIRE_QUEUE) private readonly queue: Queue<CouponExpireJobData>,
  ) {}

  async onModuleInit(): Promise<void> {
    // 审查报告 P1 #8（settle.scheduler 同款）：repeat job 不能同时指定 jobId
    await this.queue.add(
      COUPON_EXPIRE_JOB_RUN,
      {} as CouponExpireJobData,
      {
        repeat: { pattern: COUPON_EXPIRE_CRON_PATTERN, tz: COUPON_EXPIRE_CRON_TZ, key: COUPON_EXPIRE_REPEAT_KEY },
      },
    );
    logger.info({
      msg: 'coupon_expire_scheduler_registered',
      pattern: COUPON_EXPIRE_CRON_PATTERN,
      tz: COUPON_EXPIRE_CRON_TZ,
    });
  }
}
