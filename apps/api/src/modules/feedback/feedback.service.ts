/**
 * Feedback Service — 用户反馈业务（P22 F1，2026-08-19）
 *
 * 设计：
 * - 反馈不挂订单、无需审核流程（区别于 Review/RiderReview），仅落库供后台查看
 * - category 六值纯枚举（前端 FEEDBACK_TYPE_KEYS 提交前转尾段）
 * - content 单语言原话（不做 i18n JSON）
 * - images URL 必须 isOwnUrl（防 SSRF/追踪/钓鱼，同 Refund.photos P13 审查 P1 模式）
 * - MVP 无 admin 列表端点（先落数据，后台消费排期后再加）
 *
 * 错误码：E-FEEDBACK-001(images 非本服务上传 409) + E-COMMON-001
 */
import { Injectable, Inject, ConflictException } from '@nestjs/common';
import { db } from '../../shared/db';
import { StorageService } from '../../shared/storage/storage.service';
import type { Feedback as DbFeedback } from '../../prisma/client';
import type { FeedbackCategoryValue } from './feedback.types';

/** 反馈视图（service → controller → client） */
export interface FeedbackView {
  id: string;
  userId: string;
  category: FeedbackCategoryValue;
  content: string;
  contact: string | null;
  images: string[];
  createdAt: string;
}

/** 反馈创建入参（service 内部） */
export interface CreateFeedbackInput {
  userId: string;
  category: FeedbackCategoryValue;
  content: string;
  contact?: string;
  images: string[];
}

@Injectable()
export class FeedbackService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  /** 客户提交反馈（无订单/状态校验，直接落库） */
  async createFeedback(input: CreateFeedbackInput): Promise<FeedbackView> {
    // P13 审查 P1 同款：images URL 必须由本服务 client upload 端点生成
    // （防用户绕过 upload 端点直接传 evil.com URL → 后台详情页 <img> 渲染 → SSRF/追踪/钓鱼）
    for (const imageUrl of input.images) {
      if (!this.storage.isOwnUrl(imageUrl)) {
        throw new ConflictException({
          code: 'E-FEEDBACK-001',
          message: `Image URL must be from our upload service: ${imageUrl}`,
        });
      }
    }

    const created = await db.feedback.create({
      data: {
        userId: input.userId,
        category: input.category,
        content: input.content,
        // 空串归一为 null（前端 contact 是 '' | string，DB 存 null 语义更准）
        contact: input.contact ? input.contact : null,
        images: input.images,
      },
    });
    return this.toFeedbackView(created);
  }

  private toFeedbackView(f: DbFeedback): FeedbackView {
    return {
      id: f.id,
      userId: f.userId,
      category: f.category as FeedbackCategoryValue,
      content: f.content,
      contact: f.contact,
      images: f.images,
      createdAt: f.createdAt.toISOString(),
    };
  }
}
