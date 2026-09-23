/**
 * 图形验证码闸门（批A2-2 · 决策7/8：只拦 /sms/send；服务端 svg-captcha + 一次性票据）
 *
 * 决策依据：方案v1-SMS-OTP真实接入-20260918.md 决策7（防 SMS 轰炸前置闸）+
 * 任务书-批A2-2-图形验证码链.md（执行权威）
 *
 * 实现（参照 registration-ticket.ts GETDEL 范式）：
 *   - 签发：svg-captcha 生成 4 位 SVG → Redis `captcha:{captchaId}` 存答案，TTL 60s
 *   - 消费：Lua GETDEL 原子（一次性票据，并发只能一个成功）；答案不区分大小写
 *   - 校验失败/过期/缺参 → 400 E-CAPTCHA-001（对外不区分错答/过期，防枚举）
 *   - 开关：SMS_CAPTCHA_REQUIRED（prod 默认 true，dev 默认 false；每次现读，
 *     改 env 下一请求即生效——与 readSmsDailyBudgetLimit 同款取舍）
 *
 * E-CAPTCHA 段 001-099 预留（本批只用 001）。
 */
import { randomUUID } from 'crypto';
import { HttpException, HttpStatus } from '@nestjs/common';
import svgCaptcha from 'svg-captcha';
import { redis } from '../../shared/cache';
import { logger } from '../../shared/logger/logger';

/** 图形码校验失败错误码（E-CAPTCHA 段 001-099 预留，对齐 E-SMS-001 常量导出风格） */
export const E_CAPTCHA_001 = 'E-CAPTCHA-001';

/** 票据 TTL：60s（任务书决策8） */
const CAPTCHA_TTL_SECONDS = 60;
/** 票据键前缀（命名空间 captcha:*） */
const KEY_PREFIX = 'captcha:';

/** GETDEL 原子消费（一次性票据：读出即删，并发只有一个成功） */
const CONSUME_SCRIPT = `
local data = redis.call('GETDEL', KEYS[1])
if not data then return nil end
return data
`;

/**
 * 开关：图形码是否必填
 *
 * prod 默认 true（防刷优先，闸门常开）；非 prod 默认 false（本地/E2E 不被闸）。
 * env 显式 'true'/'false' 覆盖默认（每次现读，测试与运维改配置即时生效）。
 */
export function isCaptchaRequired(): boolean {
  const explicit = process.env.SMS_CAPTCHA_REQUIRED;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

/**
 * 签发图形验证码
 *
 * @returns captchaId（客户端回传凭据）+ svg（前端直接 innerHTML 渲染）
 */
export async function issueCaptcha(): Promise<{
  captchaId: string;
  svg: string;
  expireIn: number;
}> {
  const { data, text } = svgCaptcha.create({ size: 4, ignoreChars: '0o1iIl' });
  const captchaId = randomUUID();
  // 统一小写存（校验时答案也 lowercase，大小写不敏感）
  await redis.set(`${KEY_PREFIX}${captchaId}`, text.toLowerCase(), 'EX', CAPTCHA_TTL_SECONDS);
  logger.info({
    msg: '[CAPTCHA] issued',
    captchaId,
    expireIn: CAPTCHA_TTL_SECONDS,
  });
  return { captchaId, svg: data, expireIn: CAPTCHA_TTL_SECONDS };
}

/**
 * 消费并校验图形验证码（一次性：无论对错，票据即焚）
 *
 * 开关关 → 直接放行（不发 Redis 钱也不消费）。
 * 校验失败 → 400 E-CAPTCHA-001（缺参/过期/错答统一语义，防枚举）。
 *
 * 调用时机：/sms/send 频控之前（任务书：「先图形码后频控」，防刷优先——
 * 图形码不过的请求连频控桶都不该占）。
 */
export async function assertCaptchaPassed(
  input?: { captchaId?: string; captchaText?: string },
): Promise<void> {
  if (!isCaptchaRequired()) {
    return;
  }
  const captchaId = input?.captchaId;
  const answer = input?.captchaText?.trim().toLowerCase();
  // 缺参直接拒（不碰 Redis）
  if (!captchaId || !answer) {
    throw captchaBadRequest('captchaId and captchaText are required');
  }
  const stored = (await redis.eval(CONSUME_SCRIPT, 1, `${KEY_PREFIX}${captchaId}`)) as
    | string
    | null;
  if (!stored || stored !== answer) {
    logger.warn({
      msg: 'CAPTCHA_VERIFY_FAILED',
      reason: stored ? 'wrong_answer' : 'expired_or_unknown',
      captchaId,
      note: 'captcha ticket consumed (one-time); rejected with 400 E-CAPTCHA-001',
    });
    throw captchaBadRequest('captcha invalid or expired, please retry');
  }
}

/** 400 E-CAPTCHA-001（对外统一语义：图形验证码错误，请重试） */
function captchaBadRequest(message: string): HttpException {
  return new HttpException({ code: E_CAPTCHA_001, message }, HttpStatus.BAD_REQUEST);
}
