/**
 * Notify Strategy 接口 — 通知发送策略抽象
 *
 * 决策依据：CLAUDE.md §外部服务 + W-M-C-T 流程 3 W4
 *
 * MVP 测试阶段 4 策略：
 *   - EMAIL：SendGrid（prod）/ MailHog（dev/staging）
 *   - SMS：Timor Telecom / Telkomcel（W6 切真）/ dev stub
 *   - PUSH：FCM/APNs（W6+ 真实接入）/ dev stub
 *   - WHATSAPP：WhatsApp Business API（W6 切真）/ dev stub
 *
 * 全部走 interface 抽象，dev/staging 全 mock，生产环境按服务可用性逐个切真。
 *
 * 通知类型（notifyType）：
 *   - ORDER_STATUS：订单状态变更
 *   - PAYMENT_SUCCESS：支付成功
 *   - DELIVERY_ARRIVING：骑手即将送达
 *   - PROMOTION：促销通知
 *   - SYSTEM：系统通知
 */

/** 通知通道 */
export type NotifyChannel = 'EMAIL' | 'SMS' | 'PUSH' | 'WHATSAPP';

/** 通知业务类型 */
export type NotifyType =
  | 'ORDER_STATUS'
  | 'PAYMENT_SUCCESS'
  | 'DELIVERY_ARRIVING'
  | 'PROMOTION'
  | 'SYSTEM';

/** 通知请求（统一结构） */
export interface NotifyRequest {
  /** 收件人 userId（用于查 email/phone/deviceToken） */
  userId: string;
  /** 通道 */
  channel: NotifyChannel;
  /** 业务类型 */
  type: NotifyType;
  /** 多语言标题（key=语言代码） */
  title: Record<string, string>;
  /** 多语言正文 */
  body: Record<string, string>;
  /** 业务数据（如 orderId / amount 等，模板渲染用） */
  data?: Record<string, unknown>;
  /** 用户偏好的语言代码（fallback 'en'） */
  locale?: string;
}

/** 通知发送结果 */
export interface NotifyResult {
  success: boolean;
  /** 策略生成的消息 ID（mock 时为 mock_xxx） */
  messageId?: string;
  /** mock/stub 标记（prod 必须为 false） */
  mockFlag: boolean;
  /** 错误信息（失败时） */
  error?: string;
}

/** Strategy 接口（每个 channel 实现一个） */
export interface NotifyStrategy {
  readonly channel: NotifyChannel;
  send(request: NotifyRequest): Promise<NotifyResult>;
}
