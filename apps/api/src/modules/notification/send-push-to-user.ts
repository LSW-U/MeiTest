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
 * 批N4（2026-09-10）：成功真发时回传 pushTicketId（Expo push ticket）——调用方
 * （admin 批次推送 / processor）聚合后入延迟 job 拉取 getReceipts 校准回执；
 * stub 通道 / mock messageId 一律 null（无真实回执可查）。
 *
 * 批N4 审查 P2-1：失败且 messageId 带 `invalid:` 前缀（Expo NotRegistered/
 * DeviceNotRegistered）→ 当场把该 DeviceToken 置 INVALID（admin 批次链路的
 * 死 token 即时清理点；事件链路 notification-event.service 同款消费）。
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
  /**
   * Expo push ticket id（批N4：成功发送时 PUSH 策略返回 receipt 查询凭证）。
   * null = stub 通道 / 发送失败 / mockFlag 结果——回执 sweep 只对真 ticket 有意义。
   */
  pushTicketId: string | null;
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
    return { pushFailed: 1, pushError: 'NotifyFactory not available', pushTicketId: null };
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
    return { pushFailed: 0, pushError: null, pushTicketId: null };
  }

  // 无 token：站内信已落，PUSH 无从发送，不计失败（避免 stub 模式群发全员 failed）
  if (tokens.length === 0) {
    return { pushFailed: 0, pushError: null, pushTicketId: null };
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
        // 批N4 审查 P2-1（2026-09-10）：消费 push.strategy 的 invalid: 标记 → token 置
        // INVALID（与事件链路 notification-event.service.ts:163 对称；死 token 不清会
        // 持续累积污染群发 failedCount——admin 批次链路唯一 PUSH helper 就是本函数）
        if (pushRes.messageId?.startsWith('invalid:')) {
          try {
            await db.deviceToken.updateMany({
              where: { userId, token: t.token },
              data: { status: 'INVALID' },
            });
          } catch (e) {
            logger.warn({
              msg: 'PUSH_INVALID_TOKEN_MARK_FAILED',
              userId,
              tokenTail: t.token.slice(-8),
              error: (e as Error).message,
            });
          }
        }
        pushFailed = 1;
        pushError = pushRes.error ?? 'push failed';
      } else {
        // 任一 token 成功即算该用户 PUSH 成功
        // 批N4：真 Expo 通道返回 ticket id（stub 的 mock_push_* messageId 不回查回执）
        const ticketId =
          pushRes?.messageId && !pushRes.mockFlag && !pushRes.messageId.startsWith('mock_')
            ? pushRes.messageId
            : null;
        return { pushFailed: 0, pushError: null, pushTicketId: ticketId };
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
  return { pushFailed, pushError, pushTicketId: null };
}
