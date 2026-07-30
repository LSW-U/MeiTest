/**
 * Search 模块 schema（热搜词 + 运营种子词，2026-07-31）
 *
 * 路线 B：Redis ZSET 实时计数排行 + SearchLog 明细审计 + HotSearchTerm 运营种子词。
 * 客户端 GET /client/search/hot 返 HotSearchTermItem[]（word + searchCount）。
 */
import { z } from 'zod';

export const HotSearchType = z.enum(['PINNED', 'MANUAL', 'BLOCKED']);

/** 热搜支持语言（复用 SUPPORTED_LOCALES，5 语言各一个 ZSET） */
export const SearchLang = z.enum(['en', 'zh', 'id', 'pt', 'tet']);

/** 客户端热搜项（GET /client/search/hot 返，word 是实际搜索词非 i18n key） */
export const HotSearchTermItem = z.object({
  word: z.string(),
  searchCount: z.number().int(),
});

/** 运营种子词实体（admin 管理） */
export const HotSearchTerm = z.object({
  id: z.string().uuid(),
  word: z.string(),
  lang: SearchLang,
  type: HotSearchType,
  sortOrder: z.number().int(),
  status: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const CreateHotSearchTermRequest = z.object({
  word: z.string().min(1).max(50),
  lang: SearchLang,
  type: HotSearchType,
  sortOrder: z.number().int().optional(),
  status: z.string().optional(),
});

export const UpdateHotSearchTermRequest = CreateHotSearchTermRequest.partial();

/** 零结果词（admin 运营分析：用户搜了但无商品，补货/补词依据） */
export const ZeroResultTerm = z.object({
  word: z.string(),
  lang: z.string(),
  count: z.number().int(),
});
