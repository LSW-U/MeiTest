/**
 * IM schemas — 流程 M W3（自建 WebSocket，三方会话）
 *
 * 决策依据：
 * - 决策 2026-06-24：IM 不接腾讯 IM/融云，自建 WS（复用 Socket.IO RealtimeGateway）
 * - 原 W-M-C-T 任务 "用户签名接口" 在自建 WS 场景下等价为：返回 WS 连接元信息给三端 SDK
 *   （客户端已知自己的 access token；本接口只补 URL / namespace / 事件名 / 会话 ID 格式）
 *
 * 错误码段：E-IM-*（W2-COLLABORATION.md §3.4 流程 M 段 001-099）
 */
import { z } from 'zod';
import { IsoTimestamp } from './common';

// ============================================================================
// ImSignature — 用户签名/连接信息
// ============================================================================

/** 会话类型（与 RealtimeGateway.ConversationType 对齐） */
export const ConversationType = z.enum(['customer_merchant', 'customer_rider', 'customer_service']);
export type ConversationTypeType = z.infer<typeof ConversationType>;

/** WS 鉴权方式（自建 WS 直接复用 access token） */
export const ImAuthScheme = z.enum(['bearer']);
export type ImAuthSchemeType = z.infer<typeof ImAuthScheme>;

/** 单条会话 ID 格式说明（前端按字符串模板拼接） */
export const ConversationIdFormat = z.object({
  /** 模板字符串，前端用实际 ID 替换占位符 */
  template: z.string().min(1),
  /** 占位符列表 */
  placeholders: z.array(z.string()).min(1),
});
export type ConversationIdFormatType = z.infer<typeof ConversationIdFormat>;

/** IM 用户签名响应（GET /api/v1/im/signature） */
export const ImSignature = z.object({
  /** WS server URL（如 ws://localhost:3001 或 wss://api.example.com） */
  url: z.string().min(1),
  /** WS namespace（与 RealtimeGateway.WS_NAMESPACE 一致） */
  namespace: z.string().min(1),
  /** 首选 transport（Socket.IO 协商时用） */
  transport: z.enum(['websocket', 'polling']).default('websocket'),
  /** 鉴权方式：自建 WS 用 bearer（access token） */
  authScheme: ImAuthScheme,
  /** 当前用户 ID（用于客户端构造 conversationId） */
  userId: z.string().min(1),
  /** 当前用户角色 */
  role: z.enum(['CUSTOMER', 'RIDER', 'SUPER_ADMIN', 'CUSTOMER_SERVICE']),
  /** 服务端事件名（客户端订阅这些） */
  serverEvents: z.array(z.string()).min(1),
  /** 客户端可发送的事件名 */
  clientEvents: z.array(z.string()).min(1),
  /** 三类会话 ID 模板 */
  conversationFormats: z.object({
    customerMerchant: ConversationIdFormat,
    customerRider: ConversationIdFormat,
    customerService: ConversationIdFormat,
  }),
  /** 服务端时间（客户端用于校准时钟） */
  serverTime: IsoTimestamp,
  /** 消息历史保留窗口（天） */
  messageRetentionDays: z.number().int().positive(),
});
export type ImSignatureType = z.infer<typeof ImSignature>;

/** IM 消息（与 RealtimeGateway.ImMessage 对齐，用于客户端识别广播） */
export const ImMessage = z.object({
  messageId: z.string().min(1),
  conversationId: z.string().min(1),
  conversationType: ConversationType,
  senderId: z.string().min(1),
  senderRole: z.enum(['CUSTOMER', 'RIDER', 'SUPER_ADMIN', 'CUSTOMER_SERVICE']),
  content: z.string().min(1).max(2000),
  timestamp: z.number().int().nonnegative(),
});
export type ImMessageType = z.infer<typeof ImMessage>;

// ============================================================================
// 错误码（E-IM-*）
// ============================================================================

/**
 * E-IM-001：会话 ID 格式不合法（必须以 conv: 开头）
 * E-IM-002：消息内容超过 2000 字符上限
 * E-IM-003：未鉴权（WS handshake 未通过 / access token 缺失）
 */
