/**
 * Feedback 模块 schema（P22 反馈页，2026-08-19）
 *
 * 设计：
 * - category 纯枚举（前端 FEEDBACK_TYPE_KEYS 是完整 i18n key `service.feedback.types.feature`，
 *   提交前 .split('.').pop() 取尾段，与 testID 取法一致）
 * - content 单语言纯文本（用户当前语言原话，不做 i18n JSON —— 反馈是用户原话不翻译）
 * - 校验规则取自前端 feedbackSchema 蓝本（category 必选 / content 10-500 / contact ≤60 可选）
 *   + 补 images 字段（前端 photos 仅存本地 state 提交时丢弃，接后端后并入表单）
 * - images max 9 后端宽松（同 review/refund 惯例），前端限 3 张
 */
import { z } from 'zod';
import { Id, IsoTimestamp } from './common';
/** 反馈类型（与前端 FEEDBACK_TYPE_KEYS 尾段对齐） */
export const FeedbackCategory = z.enum([
  'feature', // 功能建议
  'product', // 商品问题
  'order', // 订单问题
  'payment', // 支付问题
  'shipping', // 配送问题
  'other', // 其他
]);

/** 反馈视图 */
export const Feedback = z.object({
  id: Id,
  userId: Id,
  category: FeedbackCategory,
  content: z.string(),
  contact: z.string().nullable(),
  images: z.array(z.string()),
  createdAt: IsoTimestamp,
});

/** 客户提交反馈（C 端 POST /client/feedback） */
export const CreateFeedbackRequest = z.object({
  category: FeedbackCategory,
  /** 反馈正文（10-500 字，前端 schema 同规则） */
  content: z.string().min(10).max(500),
  /** 联系方式（可选 ≤60：电话/邮箱/WhatsApp，回访用） */
  contact: z.string().max(60).optional(),
  /** 截图 URL（前端先调 POST /client/uploads/feedback-image 拿 URL 再提交） */
  images: z.array(z.string().url()).max(9).default([]),
});

// ============================================================================
// 反馈管理（admin-web 优化方案 批次2 2026-08-29）
// 后台只读：GET /admin/feedback 列表 + GET /admin/feedback/:id 详情
// MVP 不加处理状态字段（避免 migration），「处理状态」列为后续增强项
// ============================================================================

/** 后台反馈列表项（含提交人摘要，供列表页展示） */
export const AdminFeedbackListItem = z.object({
  id: Id,
  userId: Id,
  category: FeedbackCategory,
  content: z.string(),
  contact: z.string().nullable(),
  images: z.array(z.string()),
  createdAt: IsoTimestamp,
  /** 提交人摘要（user join；DELETED 用户也保留，仅展示用） */
  submitter: z
    .object({
      id: Id,
      phone: z.string().nullable(),
      name: z.string().nullable(),
      avatarUrl: z.string().nullable(),
    })
    .nullable(),
});

/** 后台反馈详情（列表项 + 提交人扩展，详情页用） */
export const AdminFeedbackDetail = AdminFeedbackListItem.extend({
  submitter: z
    .object({
      id: Id,
      phone: z.string().nullable(),
      email: z.string().email().nullable(),
      name: z.string().nullable(),
      avatarUrl: z.string().nullable(),
      role: z.string(),
      status: z.string(),
    })
    .nullable(),
});

/** 后台反馈列表响应 data（offset 分页） */
export const AdminFeedbackListResponseData = z.object({
  items: z.array(AdminFeedbackListItem),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

/** 后台反馈列表 query（category 筛选 + 时间范围 + keyword + 分页） */
export const AdminListFeedbackQuery = z.object({
  category: FeedbackCategory.optional(),
  /** keyword 模糊匹配 content / contact */
  keyword: z.string().max(200).optional(),
  /** 起始时间（含），ISO 8601 */
  startDate: IsoTimestamp.optional(),
  /** 结束时间（含），ISO 8601 */
  endDate: IsoTimestamp.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
