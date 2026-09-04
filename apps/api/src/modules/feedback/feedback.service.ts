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
import { Injectable, Inject, ConflictException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { db } from '../../shared/db';
import { StorageService } from '../../shared/storage/storage.service';
import type { Feedback as DbFeedback, User as DbUser, Prisma } from '../../prisma/client';
import {
  FeedbackCategorySchema,
  type FeedbackView,
} from './feedback.types';
import {
  AdminFeedbackListItem,
  AdminFeedbackDetail,
} from '@meimart/api-contract';

/** 后台反馈列表项视图（contract schema 推导，避免双源漂移） */
type AdminFeedbackListView = z.infer<typeof AdminFeedbackListItem>;
/** 后台反馈详情视图 */
type AdminFeedbackDetailView = z.infer<typeof AdminFeedbackDetail>;

/** 反馈创建入参（service 内部） */
export interface CreateFeedbackInput {
  userId: string;
  /** category 已由 contract CreateFeedbackRequest z.enum 校验 */
  category: string;
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
    // F4：DB category 是 String，用 contract zod safeParse 收敛为枚举（防历史脏数据透传前端）。
    // CHECK 约束是写入保险，读出仍需收敛（旧数据可能早于约束存在）。
    const parsed = FeedbackCategorySchema.safeParse(f.category);
    return {
      id: f.id,
      userId: f.userId,
      category: parsed.success ? parsed.data : 'other',
      content: f.content,
      contact: f.contact,
      images: f.images,
      createdAt: f.createdAt.toISOString(),
    };
  }

  // ===== Admin: 反馈管理（admin-web 优化方案 批次2 2026-08-29，只读） =====

  /**
   * 后台反馈列表（offset 分页 + category 筛选 + 时间范围 + keyword）
   *
   * keyword 模糊匹配 content / contact（不匹配 userId，运营视角按内容检索更自然）。
   * 时间范围：startDate / endDate 均含边界（createdAt >= startDate && createdAt <= endDate）。
   * include submitter：phone + name + avatarUrl（列表页展示提交人摘要，user 软删也保留）。
   */
  async adminListFeedback(opts: {
    category?: string;
    keyword?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<{
    items: AdminFeedbackListView[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  }> {
    const page = Math.max(opts.page ?? 1, 1);
    const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 100);
    const skip = (page - 1) * pageSize;

    const where: Prisma.FeedbackWhereInput = {};
    if (opts.category) where.category = opts.category;
    if (opts.startDate || opts.endDate) {
      where.createdAt = {};
      if (opts.startDate) where.createdAt.gte = new Date(opts.startDate);
      // endDate 含边界：+1 day - 1ms 等价于「当天结束」由前端传完整 ISO；这里直接 <= endDate
      if (opts.endDate) where.createdAt.lte = new Date(opts.endDate);
    }
    if (opts.keyword && opts.keyword.trim().length > 0) {
      const kw = opts.keyword.trim();
      where.OR = [
        { content: { contains: kw, mode: 'insensitive' } },
        { contact: { contains: kw, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      db.feedback.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: { user: { select: { id: true, phone: true, name: true, avatarUrl: true } } },
      }),
      db.feedback.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.toAdminListItem(r)),
      page,
      pageSize,
      total,
      hasMore: skip + rows.length < total,
    };
  }

  /**
   * 后台反馈详情（含 images 截图 URL + 提交人扩展信息）
   *
   * @throws NotFoundException E-FEEDBACK-002 反馈不存在
   */
  async adminGetFeedback(id: string): Promise<AdminFeedbackDetailView> {
    const row = await db.feedback.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            phone: true,
            email: true,
            name: true,
            avatarUrl: true,
            role: true,
            status: true,
          },
        },
      },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'E-FEEDBACK-002',
        message: 'Feedback not found',
      });
    }
    return this.toAdminDetail(row);
  }

  /** 列表项 DTO（submitter 摘要：phone/name/avatarUrl） */
  private toAdminListItem(
    r: DbFeedback & {
      user: Pick<DbUser, 'id' | 'phone' | 'name' | 'avatarUrl'> | null;
    },
  ): AdminFeedbackListView {
    const parsed = FeedbackCategorySchema.safeParse(r.category);
    return {
      id: r.id,
      userId: r.userId,
      category: parsed.success ? parsed.data : 'other',
      content: r.content,
      contact: r.contact,
      images: r.images,
      createdAt: r.createdAt.toISOString(),
      submitter: r.user
        ? {
            id: r.user.id,
            phone: r.user.phone,
            name: r.user.name,
            avatarUrl: r.user.avatarUrl,
          }
        : null,
    };
  }

  /** 详情 DTO（submitter 扩展：含 email/role/status） */
  private toAdminDetail(
    r: DbFeedback & {
      user:
        | (Pick<
            DbUser,
            'id' | 'phone' | 'email' | 'name' | 'avatarUrl' | 'role' | 'status'
          >)
        | null;
    },
  ): AdminFeedbackDetailView {
    const parsed = FeedbackCategorySchema.safeParse(r.category);
    return {
      id: r.id,
      userId: r.userId,
      category: parsed.success ? parsed.data : 'other',
      content: r.content,
      contact: r.contact,
      images: r.images,
      createdAt: r.createdAt.toISOString(),
      submitter: r.user
        ? {
            id: r.user.id,
            phone: r.user.phone,
            email: r.user.email,
            name: r.user.name,
            avatarUrl: r.user.avatarUrl,
            role: r.user.role,
            status: r.user.status,
          }
        : null,
    };
  }
}
