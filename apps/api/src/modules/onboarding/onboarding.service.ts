/**
 * Onboarding Service — 引导页 slide 业务（批1，2026-10-14）
 *
 * 设计：
 * - client 端点：enabled=true 按 sortOrder 升序，空表返回 []（前端回退本地 SLIDES 兜底）
 * - admin CRUD：title/description 五语 JSON 校验（en 必填，方案v2 D4/批2 表单口径对齐）
 * - 物理删除（Banner 同模式；slides 无关联数据，不软删）
 * - imageUrl 走 slide-image 上传端点产出（batch1 upload 场景），URL 归属校验沿用
 *   Feedback/Refund 的 isOwnUrl 防线（防 evil.com URL 经 admin 详情渲染 SSRF）
 *
 * 错误码：E-ONBOARDING-001(五语对象非法) / E-ONBOARDING-002(slide 不存在) / E-ONBOARDING-003(URL 非本服务)
 */
import { Injectable, NotFoundException, BadRequestException, ConflictException, Inject } from '@nestjs/common';
import { z } from 'zod';
import { db } from '../../shared/db';
import { StorageService } from '../../shared/storage/storage.service';
import { I18nText, LanguageCode } from '@meimart/api-contract';

/** 五语键集（en/id/pt/tet/zh，对齐契约 LanguageCode） */
const I18N_KEYS = LanguageCode.options;

/** 五语文案：五语对象且 en 必填非空（缺其他语言由前端 fallback en） */
export const LocalizedTextSchema = I18nText.superRefine((val, ctx) => {
  for (const key of Object.keys(val)) {
    if (!I18N_KEYS.includes(key as (typeof I18N_KEYS)[number])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid language key "${key}", allowed: ${I18N_KEYS.join('/')}`,
      });
    }
  }
  if (typeof val.en !== 'string' || val.en.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '"en" is required and must be a non-empty string (other languages fallback to en)',
    });
  }
});

/** slide 视图（DB 行 → 契约形态，Json 字段断言为 Record<string,string>） */
export interface OnboardingSlideView {
  id: string;
  icon: string | null;
  imageUrl: string | null;
  title: Record<string, string>;
  description: Record<string, string>;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** service 入参（controller 已过 zod；service 再做五语语义校验） */
export interface UpsertSlideInput {
  icon?: string | null;
  imageUrl?: string | null;
  title: Record<string, string>;
  description: Record<string, string>;
  sortOrder?: number;
  enabled?: boolean;
}

@Injectable()
export class OnboardingService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  /** 客户端引导页列表（@Public 匿名可达）：仅 enabled，按 sortOrder 升序 */
  async listEnabledSlides(): Promise<OnboardingSlideView[]> {
    const rows = await db.onboardingSlide.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  /** 后台列表（含 disabled，运营要看全量） */
  async listAllSlides(): Promise<OnboardingSlideView[]> {
    const rows = await db.onboardingSlide.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  async createSlide(input: UpsertSlideInput): Promise<OnboardingSlideView> {
    this.validateI18n(input);
    await this.validateImageUrl(input.imageUrl);
    const created = await db.onboardingSlide.create({
      data: {
        icon: input.icon ?? null,
        imageUrl: input.imageUrl ?? null,
        title: input.title,
        description: input.description,
        sortOrder: input.sortOrder ?? 0,
        enabled: input.enabled ?? true,
      },
    });
    return this.toView(created);
  }

  async updateSlide(id: string, input: Partial<UpsertSlideInput>): Promise<OnboardingSlideView> {
    const existing = await db.onboardingSlide.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'E-ONBOARDING-002', message: 'Slide not found' });
    }
    this.validateI18n(input);
    await this.validateImageUrl(input.imageUrl);
    const updated = await db.onboardingSlide.update({
      where: { id },
      data: {
        ...(input.icon !== undefined && { icon: input.icon }),
        ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
      },
    });
    return this.toView(updated);
  }

  /** 物理删除（Banner 同模式） */
  async deleteSlide(id: string): Promise<void> {
    const existing = await db.onboardingSlide.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'E-ONBOARDING-002', message: 'Slide not found' });
    }
    await db.onboardingSlide.delete({ where: { id } });
  }

  // ===== 内部 =====

  /**
   * 五语对象校验（title/description 提供时必须合法）
   *
   * PATCH 部分字段：只校验提供的字段；完全未提供则跳过（title/description 建表 NOT NULL，
   * create 必传由 controller zod 保证）
   */
  private validateI18n(input: Partial<UpsertSlideInput>): void {
    for (const field of ['title', 'description'] as const) {
      const val = input[field];
      if (val === undefined) continue;
      const parsed = LocalizedTextSchema.safeParse(val);
      if (!parsed.success) {
        throw new BadRequestException({
          code: 'E-ONBOARDING-001',
          message: `${field} must be an i18n object with non-empty "en" (keys: ${I18N_KEYS.join('/')})`,
          details: { field, issues: parsed.error.issues.map((i) => i.message) },
        });
      }
    }
  }

  /**
   * imageUrl 必须由本服务 upload 端点生成（isOwnUrl 防线，Feedback/Refund P1 同款）
   * icon/imageUrl 二选一由前端表单保证，后端不强校验共存（空文案+空图的 slide 客户端可自行跳过）
   */
  private async validateImageUrl(imageUrl?: string | null): Promise<void> {
    if (!imageUrl) return;
    if (!this.storage.isOwnUrl(imageUrl)) {
      throw new ConflictException({
        code: 'E-ONBOARDING-003',
        message: `Image URL must be from our upload service: ${imageUrl}`,
      });
    }
  }

  /** DB 行 → 契约视图（Json 断言 + 时间 ISO 化，Banner 同模式） */
  private toView(row: {
    id: string;
    icon: string | null;
    imageUrl: string | null;
    title: unknown;
    description: unknown;
    sortOrder: number;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): OnboardingSlideView {
    return {
      id: row.id,
      icon: row.icon,
      imageUrl: row.imageUrl,
      title: row.title as Record<string, string>,
      description: row.description as Record<string, string>,
      sortOrder: row.sortOrder,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
