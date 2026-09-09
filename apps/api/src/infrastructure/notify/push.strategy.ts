/**
 * Push 策略 — Expo Push（批A A2 切真）+ dev stub 降级
 *
 * 决策依据：批A 任务书 A2（2026-09-09）+ 方案v2 §3.2
 *
 * 通道选择（env PUSH_PROVIDER，默认 stub）：
 *   - 'expo'：真实调 Expo Push API
 *     POST https://exp.host/--/api/v2/push/send（≤100 条/请求，分块发送）
 *     凭证 EXPO_ACCESS_TOKEN 可选（无凭证时 Expo 接受匿名推送，仅限 development build）
 *   - 'stub'（默认 / dev 无凭证自动降级）：MVP stub，日志记录推送内容，mockFlag=true
 *
 * 降级规则：PUSH_PROVIDER=expo 但未配 EXPO_ACCESS_TOKEN 且 NODE_ENV!=='production'
 * → 警告日志 + stub 降级（不崩）；production 缺凭证硬降级同样放行（MVP 无海外主体）。
 *
 * 失败回执（仅 expo 通道）：
 *   - Expo 返回 NotRegistered/DeviceNotRegistered（details.error）→ messageId 带
 *     'invalid:<token>' 标记，由调用方（notification-event.service / admin 批次推送）
 *     据此把 DeviceToken 置 INVALID——本策略不直接写 DB（保持策略层无状态）。
 */
import { Injectable } from '@nestjs/common';
import { logger } from '../../shared/logger/logger';
import type { NotifyStrategy, NotifyRequest, NotifyResult } from './notify-strategy';

/** Expo Push API 单请求上限（官方约束；单条 send 只发 1 条，批量分块在 processor 层） */
export const EXPO_PUSH_CHUNK_SIZE = 100;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** DeviceToken 无效（应置 INVALID）的 Expo 错误码 */
export const EXPO_INVALID_TOKEN_ERRORS = new Set(['NotRegistered', 'DeviceNotRegistered']);

/**
 * 解析推送通道：PUSH_PROVIDER=expo 且（有凭证 或 非生产降级放行）→ expo，否则 stub
 *
 * 审查 P3-2：结果模块级缓存——send 每次调用 resolveProvider，dev 无凭证下群发
 * 1000 人会打 1000 条重复 warn；env 只在进程启动时读取，缓存安全（测试用
 * clearPushProviderCache() 重置）。
 */
let cachedProvider: 'expo' | 'stub' | null = null;

/** 重置通道解析缓存（仅测试用：process.env 切换后调用） */
export function clearPushProviderCache(): void {
  cachedProvider = null;
}

function resolveProvider(): 'expo' | 'stub' {
  if (cachedProvider) return cachedProvider;
  if (process.env.PUSH_PROVIDER !== 'expo') {
    cachedProvider = 'stub';
    return cachedProvider;
  }
  const token = process.env.EXPO_ACCESS_TOKEN;
  if (token) {
    cachedProvider = 'expo';
    return cachedProvider;
  }
  // 首次解析才 warn（群发千人不重复刷屏）
  if (process.env.NODE_ENV === 'production') {
    // MVP：production 缺凭证仍降级（无海外主体阶段），只告警
    logger.warn({
      msg: 'PUSH_PROVIDER_EXPO_NO_TOKEN_IN_PRODUCTION',
      note: 'EXPO_ACCESS_TOKEN not set; falling back to stub push (mockFlag=true)',
    });
  } else {
    logger.warn({
      msg: 'PUSH_PROVIDER_EXPO_NO_TOKEN',
      note: 'EXPO_ACCESS_TOKEN not set in dev; stub push fallback (mockFlag=true)',
    });
  }
  cachedProvider = 'stub';
  return cachedProvider;
}

@Injectable()
export class PushNotifyStrategy implements NotifyStrategy {
  readonly channel = 'PUSH' as const;

  async send(request: NotifyRequest): Promise<NotifyResult> {
    if (resolveProvider() === 'expo') {
      return this.sendViaExpo(request);
    }
    return this.sendStub(request);
  }

  /** dev stub：日志记录，mockFlag=true（W1 行为保持） */
  private sendStub(request: NotifyRequest): NotifyResult {
    const locale = request.locale ?? 'en';
    const title = request.title[locale] ?? request.title.en ?? '';
    const body = request.body[locale] ?? request.body.en ?? '';

    const messageId = `mock_push_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    logger.info({
      msg: 'NOTIFY_PUSH_SENT',
      channel: 'PUSH',
      userId: request.userId,
      type: request.type,
      title,
      bodyPreview: body.slice(0, 80),
      data: request.data,
      messageId,
      mockFlag: true,
      note: 'PUSH_PROVIDER=expo + EXPO_ACCESS_TOKEN 后切真（批A A2）',
    });

    return { success: true, messageId, mockFlag: true };
  }

  /**
   * Expo Push 真实通道：POST /--/api/v2/push/send
   *
   * token 从 request.data.token 取（事件/批次推送方把 DeviceToken.token 放进 data）；
   * 无 token → success=false（调用方降级站内信）。
   * 网络失败不抛错，返回 success=false + error（通知失败容忍原则）。
   */
  private async sendViaExpo(request: NotifyRequest): Promise<NotifyResult> {
    const token = typeof request.data?.token === 'string' ? request.data.token : undefined;
    if (!token) {
      return { success: false, error: 'MISSING_DEVICE_TOKEN', mockFlag: false };
    }

    const locale = request.locale ?? 'en';
    const title = request.title[locale] ?? request.title.en ?? '';
    const body = request.body[locale] ?? request.body.en ?? '';

    const message = {
      to: token,
      title,
      body,
      data: (request.data ?? {}) as Record<string, unknown>,
      sound: 'default',
    };

    // ≤100 条/请求：单条 send 只发 1 条，分块逻辑留给批量入口（admin 批A A5）
    let response: Response;
    try {
      response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.EXPO_ACCESS_TOKEN
            ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify([message]),
      });
    } catch (e) {
      logger.warn({
        msg: 'NOTIFY_PUSH_EXPO_FETCH_FAILED',
        userId: request.userId,
        error: (e as Error).message,
      });
      return { success: false, error: (e as Error).message, mockFlag: false };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.warn({
        msg: 'NOTIFY_PUSH_EXPO_HTTP_ERROR',
        userId: request.userId,
        status: response.status,
        bodyPreview: text.slice(0, 200),
      });
      return { success: false, error: `EXPO_HTTP_${response.status}`, mockFlag: false };
    }

    const payload = (await response.json().catch(() => null)) as {
      data?: Array<{ status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } }>;
    } | null;
    const receipt = payload?.data?.[0];
    if (!receipt) {
      return { success: false, error: 'EXPO_BAD_RESPONSE', mockFlag: false };
    }
    if (receipt.status === 'error') {
      const errCode = receipt.details?.error ?? 'UNKNOWN';
      // token 失效 → messageId 带标记，调用方据 INVALID 标记置 DeviceToken.INVALID
      if (EXPO_INVALID_TOKEN_ERRORS.has(errCode)) {
        logger.warn({
          msg: 'NOTIFY_PUSH_EXPO_TOKEN_INVALID',
          userId: request.userId,
          expoError: errCode,
        });
        return { success: false, messageId: `invalid:${token}`, error: errCode, mockFlag: false };
      }
      logger.warn({
        msg: 'NOTIFY_PUSH_EXPO_RECEIPT_ERROR',
        userId: request.userId,
        expoError: errCode,
        message: receipt.message,
      });
      return { success: false, error: errCode, mockFlag: false };
    }

    return { success: true, messageId: receipt.id, mockFlag: false };
  }
}
