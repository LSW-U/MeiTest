/**
 * Legal Service — 法律文档下发（P5 #3，2026-08-25）
 *
 * 职责：
 *   - 按 docType（TERMS / PRIVACY）取当前生效版本（is_active=true）
 *   - 按 Accept-Language 切片 content 多语言 JSON，返回单语言正文 + 元信息
 *
 * 决策依据：
 *   - P5 §7 P0：协议页正文硬编码 → 改读后端（支持版本管理 + 多语言）
 *   - content 存多语言 JSON（en/zh/id/pt/tet），与 Product.name 等 i18n 字段一致
 *   - MVP 无 admin 编辑后台 → seed 预置；DB 层部分唯一索引保证同 docType 仅一条 active
 *
 * 错误码：未找到 active 文档 → E-LEGAL-001
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { db } from '../../shared/db';
import {
  detectLanguage,
  pickI18nField,
  type SupportedLanguage,
} from '@meimart/shared-utils';

export type LegalDocType = 'TERMS' | 'PRIVACY' | 'LICENSE';

/** 法律文档视图（按请求语言切片） */
export interface LegalDocumentView {
  docType: LegalDocType;
  version: string;
  /** 单语言正文（fallback 链 lang → en → ""） */
  content: string;
  /** 生效时间（ISO UTC，前端展示「最近更新于」） */
  effectiveAt: string;
}

const ALLOWED_DOC_TYPES: readonly LegalDocType[] = ['TERMS', 'PRIVACY', 'LICENSE'];

@Injectable()
export class LegalService {
  /**
   * 取指定 docType 当前生效版本，按语言切片下发。
   *
   * @param docType    TERMS / PRIVACY
   * @param acceptLang Accept-Language header 原值
   */
  async getActiveDoc(
    docType: string,
    acceptLang: string | undefined,
  ): Promise<LegalDocumentView> {
    // docType 白名单校验（路径参数，防止扫描）
    if (!ALLOWED_DOC_TYPES.includes(docType as LegalDocType)) {
      throw new NotFoundException({
        code: 'E-LEGAL-001',
        message: `Legal document not found: ${docType}`,
      });
    }

    const doc = await db.legalDocument.findFirst({
      where: { docType, isActive: true },
      orderBy: { effectiveAt: 'desc' },
    });

    if (!doc) {
      throw new NotFoundException({
        code: 'E-LEGAL-001',
        message: `Legal document not initialized (need seed: ${docType})`,
      });
    }

    const lang: SupportedLanguage = detectLanguage(acceptLang);
    const i18nContent = (doc.content as Record<string, string>) ?? {};
    const content = pickI18nField(i18nContent, lang);

    return {
      docType: doc.docType as LegalDocType,
      version: doc.version,
      content,
      effectiveAt: doc.effectiveAt.toISOString(),
    };
  }
}
