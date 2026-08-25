/**
 * Feedback 模块类型定义（P22 F1，2026-08-19；F4 重构 2026-08-25 单一来源）
 *
 * 类型对齐（F4 修复）：
 *   - FeedbackCategoryValue 直接从 contract zod enum 推导（z.infer），不再手写 FEEDBACK_CATEGORIES 常量
 *     → contract 是唯一真相源，删/加枚举值只改 contract，不会出现 service 与 contract 值域漂移
 *   - FeedbackView 直接从 contract Feedback schema 推导，不再手写 interface（避免双源漂移）
 *   - Prisma category 是 String（非 enum），DB CHECK 约束见 migration 20260825000002
 *
 * 运行时收敛：暴露 FeedbackCategory（zod schema）供 controller/service 做 safeParse，
 *   防御 DB 脏数据（CHECK 约束是后置保险，service 读出时仍需收敛）。
 */
import { z } from 'zod';
import { FeedbackCategory, Feedback } from '@meimart/api-contract';

/** 反馈类型枚举值（单一来源：contract zod enum） */
export type FeedbackCategoryValue = z.infer<typeof FeedbackCategory>;

/** 运行时收敛：供 service 读 DB 时校验 category 是否在枚举内（防历史脏数据透传到前端） */
export const FeedbackCategorySchema = FeedbackCategory;

/**
 * 反馈视图（单一来源：contract Feedback schema 推导）
 * service → controller → client 共用此类型，与 contract 输出 schema 完全一致。
 */
export type FeedbackView = z.infer<typeof Feedback>;
