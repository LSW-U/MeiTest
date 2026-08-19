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
