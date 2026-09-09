/**
 * User Push Sender — 单用户 PUSH 公共链路（批A 审查 P2-2 修复，2026-09-09）
 *
 * 两条 PUSH 链路（事件挂点 notification-event.service / admin 批次 deliverChunk +
 * notification-push.processor）共用：先查该用户 ACTIVE DeviceToken，逐 token
 * 把 token 塞进 data 发送——expo 模式下 push.strategy 从 data.token 取目标设备，
 * 不带 token 必失败（MISSING_DEVICE_TOKEN）。
 *
 * 计数口径（审查 P3-1）：返回 delivered = 站内信/用户维度成功数、pushFailed =
 * PUSH 失败用户数（一个用户所有 token 都失败才算该用户失败；无 token 用户不计
 * PUSH 失败——站内信已落，PUSH 是增强通道）。
 *
 * 失败容忍：单 token 异常互不影响；查询 token 失败不抛（返回 pushFailed=0，
 * 由调用方决定站内信计数不受影响）。
 */
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';

/** NotifyFactory 结构化类型（与 admin-notification.service 同款） */
export interface PushNotifyFactoryLike {
  sendMulti: (
    request: {
      userId: string;
      type: string;
      title: Record<string, string>;
      body: Record<string, string>;
      data?: Record<string, unknown>;
      locale?: string;
    },
    channels: string[],
  ) => Promise<Record<string, { success: boolean; mockFlag: boolean; error?: string; messageId?: string }>>;
}

/** sendPushToUser 入参 */
export interface SendPushToUserInput {
  notifyFactory: PushNotifyFactoryLike | null;
  userId: string;
  type: string;
  title: Record<string, string>;
  content: Record<string, string>;
  /** 业务附加数据（orderId 等）；token 由本 helper 注入，调用方不用带 */
  data?: Record<string, unknown>;
}

/** sendPushToUser 结果：pushFailed = PUSH 失败用户数（0 或 1） */
export interface SendPushToUserResult {
  pushFailed: number;
  pushError: string | null;
}

/**
 * 单用户 PUSH：查 ACTIVE tokens 逐 token 发（token 注入 data.token）
 *
 * 返回 pushFailed（该用户 PUSH 是否失败，0/1）+ 首个错误信息。
 * notifyFactory 为 null（测试环境/未装配）→ 视为 PUSH 失败（与旧 deliverChunk
 * 语义一致：无推送通道时 failedCount 记满，站内信不受影响）。
 */
export async function sendPushToUser(
  input: SendPushToUserInput,
): Promise<SendPushToUserResult> {
  const { notifyFactory, userId, type, title, content, data } = input;
  if (!notifyFactory) {
    return { pushFailed: 1, pushError: 'NotifyFactory not available' };
  }

  let tokens: Array<{ token: string; locale: string }>;
  try {
    tokens = await db.deviceToken.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { token: true, locale: true },
    });
  } catch (e) {
    // token 查询失败不炸调用方（站内信链路独立）；记 warn 按 PUSH 成功处理
    // ——PUSH 是增强通道，失败容忍原则（与 notification-event.service 同款）
    logger.warn({
      msg: 'PUSH_TOKEN_QUERY_FAILED',
      userId,
      error: (e as Error).message,
    });
    return { pushFailed: 0, pushError: null };
  }

  // 无 token：站内信已落，PUSH 无从发送，不计失败（避免 stub 模式群发全员 failed）
  if (tokens.length === 0) {
    return { pushFailed: 0, pushError: null };
  }

  let pushFailed = 0;
  let pushError: string | null = null;
  for (const t of tokens) {
    try {
      const result = await notifyFactory.sendMulti(
        {
          userId,
          type,
          title,
          body: content,
          data: { ...(data ?? {}), token: t.token },
          locale: t.locale,
        },
        ['PUSH'],
      );
      const pushRes = result?.PUSH;
      if (pushRes && !pushRes.success) {
        pushFailed = 1;
        pushError = pushRes.error ?? 'push failed';
      } else {
        // 任一 token 成功即算该用户 PUSH 成功
        return { pushFailed: 0, pushError: null };
      }
    } catch (e) {
      pushFailed = 1;
      pushError = (e as Error).message;
      logger.warn({
        msg: 'PUSH_TOKEN_SEND_FAILED',
        userId,
        tokenTail: t.token.slice(-8),
        error: (e as Error).message,
      });
    }
  }
  return { pushFailed, pushError };
}
