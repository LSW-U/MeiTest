/**
 * Notification Event Service — 业务事件 → 站内信 + PUSH（批A A4，2026-09-09）
 *
 * 设计（方案v2 §3.3/§3.4）：
 *   - 入参（userId/type/title/content/data）→ 写 Notification 行 → 触发 PUSH（A2 Expo 通道）
 *   - **全链 try/catch 失败容忍**：通知失败只 logger.warn，绝不炸业务主流程
 *     ——与既有 WS 广播同款模式；调用方（order/dispatch/settle）无需再包 try/catch
 *   - **通知一律放事务外**：挂点在各服务事务提交之后调用本 service（审查重点：
 *     acceptTask 乐观锁事务 / completeTask 大事务语义不被改变）
 *   - 不引入事件总线/outbox（MVP 不过度设计，方案 §5 不做清单）
 *
 * 文案：五语言 JSON 硬编码模板（en/zh/tet/pt/id，tet 用 `[TET]+en` 占位），
 * 模板 key 落 shared-locales（notification.json，过 check:usage 门禁）。
 *
 * 推送语言：查 DeviceToken(ACTIVE, userId).locale 逐 token pick（en 兜底）；
 * 无 token 时仅站内信（验收 P2：token 管理闭环）。
 *
 * DI：tsx 无 decorator metadata，注入方必须显式 @Inject('NotificationEventServiceToken')，
 * token 由 notification.module 用 { provide: ..., useExisting } 注册（order/dispatch/settle 跨模块注入）。
 */
import { Injectable, Inject } from '@nestjs/common';
import { db } from '../../shared/db';
import { Prisma } from '../../prisma/client';
import { logger } from '../../shared/logger/logger';
import { messages } from '@meimart/shared-locales';
import type { NotificationEventType } from './notification-events.templates';

export type { NotificationEventType };

/** 事件通知入参（模板 key 渲染 + data 附加） */
export interface EventNotifyInput {
  /** 事件模板 key（决定五语言 title/content 文案） */
  event: NotificationEventType;
  /** 接收方 User.id（Notification.userId 引用 User） */
  userId: string;
  type: 'ORDER_UPDATE' | 'PROMOTION' | 'SYSTEM' | 'RIDER_TASK' | 'WALLET';
  /** 业务数据（orderId/taskId/amount 等），写 Notification.data + 推送深链 */
  data?: Record<string, unknown>;
  /** 模板插值参数（如 { amount }，目前模板直接拼 data 值，预留） */
  params?: Record<string, string>;
}

/** 模板渲染结果（五语言 title/content） */
interface RenderedTemplate {
  title: Record<string, string>;
  content: Record<string, string>;
}

/** 支持语言（与 shared-locales SUPPORTED_LOCALES 一致） */
const LOCALES = ['en', 'zh', 'id', 'pt', 'tet'] as const;

@Injectable()
export class NotificationEventService {
  constructor(
    // NotifyFactory 注入（结构与 admin-notification.service 同款；module 注册 'NotifyFactoryToken'）
    @Inject('NotifyFactoryToken')
    private readonly notifyFactory: {
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
    } | null,
  ) {}

  /**
   * 渲染事件模板为五语言 title/content
   *
   * 模板源：notification-events.templates.ts（key 与 shared-locales notification.json 同步，
   * 供 admin-web/前端消费同一份 key）。渲染简单替换 {placeholder}（MVP 不引 i18n 运行时）。
   */
  renderTemplate(event: NotificationEventType, params: Record<string, string> = {}): RenderedTemplate {
    const fill = (text: string): string =>
      text.replace(/\{(\w+)\}/g, (m, key: string) => params[key] ?? m);

    const title: Record<string, string> = {};
    const content: Record<string, string> = {};
    for (const locale of LOCALES) {
      // tet 用 `[TET]+en` 占位（CLAUDE.md §i18n 约束：Tetum 留 key 无翻译）
      const lang = locale === 'tet' ? 'en' : locale;
      const t = (messages[lang].notification as Record<string, { title: string; content: string }>)?.[event];
      title[locale] = fill(t?.title ?? event);
      content[locale] = fill(t?.content ?? event);
    }
    return { title, content };
  }

  /**
   * 事件通知入口（挂点调用）
   *
   * 流程：渲染模板 → 写 Notification 行 → PUSH（按 token.locale 逐设备发）。
   * **全链 try/catch**：任一步失败 logger.warn 返回 null，不抛错（不炸主流程）。
   */
  async notify(input: EventNotifyInput): Promise<void> {
    try {
      const { title, content } = this.renderTemplate(input.event, input.params);

      // 1. 站内信（真链路，必达）
      await db.notification.create({
        data: {
          userId: input.userId,
          type: input.type as never,
          title: title as unknown as Prisma.InputJsonValue,
          content: content as unknown as Prisma.InputJsonValue,
          isRead: false,
          data: (input.data ?? null) as unknown as Prisma.InputJsonValue,
        },
      });

      // 2. PUSH（按 DeviceToken.locale 逐设备；无 token 跳过；失败不重试不炸）
      await this.sendPush(input.userId, title, content, input.data);
    } catch (e) {
      logger.warn({
        msg: 'NOTIFICATION_EVENT_FAILED',
        event: input.event,
        userId: input.userId,
        error: (e as Error).message,
      });
    }
  }

  /**
   * PUSH 发送：查 ACTIVE tokens，按每个 token 的 locale pick 文案，逐设备发
   *
   * 单设备失败不互相影响（sendMulti 内 Promise.all 但 PUSH 单通道）——
   * 逐 token 调用并各自 catch，一个 token 异常不影响其他设备。
   */
  private async sendPush(
    userId: string,
    title: Record<string, string>,
    content: Record<string, string>,
    data?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.notifyFactory) return;
    try {
      const tokens = await db.deviceToken.findMany({
        where: { userId, status: 'ACTIVE' },
        select: { token: true, locale: true },
      });
      for (const t of tokens) {
        const locale = LOCALES.includes(t.locale as (typeof LOCALES)[number]) ? t.locale : 'en';
        try {
          const result = await this.notifyFactory.sendMulti(
            {
              userId,
              type: 'ORDER_STATUS',
              title: { [locale]: title[locale] ?? title.en ?? '' },
              body: { [locale]: content[locale] ?? content.en ?? '' },
              // 批A A2：Expo 通道需要目标 token（策略层无状态，不查 DB）
              data: { ...(data ?? {}), token: t.token },
              locale: t.locale,
            },
            ['PUSH'],
          );
          // 批A A2：Expo NotRegistered/DeviceNotRegistered → token 置 INVALID
          const pushResult = result?.PUSH;
          if (pushResult && !pushResult.success && pushResult.messageId?.startsWith('invalid:')) {
            await db.deviceToken.updateMany({
              where: { token: t.token },
              data: { status: 'INVALID' },
            });
          }
        } catch (e) {
          logger.warn({
            msg: 'NOTIFICATION_PUSH_TOKEN_FAILED',
            userId,
            tokenTail: t.token.slice(-8),
            error: (e as Error).message,
          });
        }
      }
    } catch (e) {
      logger.warn({
        msg: 'NOTIFICATION_PUSH_QUERY_FAILED',
        userId,
        error: (e as Error).message,
      });
    }
  }
}
