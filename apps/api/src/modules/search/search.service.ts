/**
 * Search Service — 热搜（路线 B：Redis ZSET + SearchLog 审计 + 运营种子词）
 *
 * - recordSearch：搜索时记日志（normalize + 防刷 dedupe + SearchLog + Redis ZINCRBY）
 * - listHot：热搜榜（PINNED 前置 + BLOCKED 剔除 + ZSET 真实 + MANUAL 兜底）
 * - admin：运营种子词 CRUD + ZSET top + 零结果词聚合
 *
 * Redis key 不带 meimart: 前缀（redis.ts Proxy 自动加 keyPrefix 'meimart:'，避免双重）。
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { db } from '../../shared/db';
import { redis } from '../../shared/cache/redis';
import { HotSearchType } from '@meimart/api-contract';

/** HotSearchType 枚举值类型（PINNED | MANUAL | BLOCKED） */
type HotSearchTypeValue = z.infer<typeof HotSearchType>;

/** Redis ZSET key（redis.ts 自动加 meimart: 前缀 → 实际 meimart:hotsearch:{lang}） */
const HOT_KEY = (lang: string) => `hotsearch:${lang}`;
/** 防刷去重 TTL（同 user/ip + 同 word 10s 内只记一次） */
const DEDUPE_TTL = 10;
const SUPPORTED_LANGS = ['en', 'zh', 'id', 'pt', 'tet'];

@Injectable()
export class SearchService {
  /**
   * 记录搜索（fire-and-forget 调用，不阻塞搜索响应）
   *
   * normalize：trim + lowerCase + slice 50，避免 Milk/milk/ milk 算 3 个词。
   * 防刷：Redis SETEX NX 10s 去重（同 user/ip + 同 word）。
   * 零结果词也记（resultCount=0 最有运营价值）。
   */
  async recordSearch(
    raw: string,
    lang: string,
    userId: string | null,
    resultCount: number,
    clientIp: string | null,
  ): Promise<void> {
    // fire-and-forget 调用（catalog.service listProducts 内 void），失败必须吞掉，
    // 否则 redis/db 异常冒 UnhandledPromiseRejection（Node warn/exit）影响进程稳定。
    try {
      const word = raw.trim().toLowerCase().slice(0, 50);
      if (!word || !SUPPORTED_LANGS.includes(lang)) return;

      const dedupeKey = `search:dedupe:${userId ?? clientIp ?? 'anon'}:${lang}:${word}`;
      const set = await redis.set(dedupeKey, '1', 'EX', DEDUPE_TTL, 'NX');
      if (!set) return; // 10s 内重复，不记

      await db.searchLog.create({
        data: {
          word,
          rawWord: raw.slice(0, 100),
          lang,
          userId,
          resultCount,
        },
      });
      await redis.zincrby(HOT_KEY(lang), 1, word);
    } catch (err) {
      // 热搜记录失败不影响搜索响应，仅日志
      console.error('[recordSearch] failed (non-fatal, search continues):', err);
    }
  }

  /**
   * 热搜榜（客户端 GET /client/search/hot）
   *
   * 1. 取运营词（status=ACTIVE）：PINNED 前置 / BLOCKED 剔除 / MANUAL 兜底
   * 2. ZSET 真实词 top N（过滤 BLOCKED + 去重 PINNED）
   * 3. 合并：PINNED + ZSET，不足 limit 补 MANUAL
   * searchCount 取 ZSET score（PINNED/MANUAL 若也在 ZSET 则带真实次数，否则 0）
   */
  async listHot(lang: string, limit: number): Promise<{ word: string; searchCount: number }[]> {
    const safeLang = SUPPORTED_LANGS.includes(lang) ? lang : 'en';
    const safeLimit = Math.min(Math.max(limit, 1), 20);

    const terms = await db.hotSearchTerm.findMany({
      where: { lang: safeLang, status: 'ACTIVE' },
    });
    const pinned = terms
      .filter((t) => t.type === 'PINNED')
      .sort((a, b) => a.sortOrder - b.sortOrder);
    // Why: blocked 用 toLowerCase normalize（PINNED "Apple" vs BLOCKED "apple" 算同词）
    const blocked = new Set(
      terms.filter((t) => t.type === 'BLOCKED').map((t) => t.word.toLowerCase()),
    );
    const manual = terms
      .filter((t) => t.type === 'MANUAL')
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // ZSET 真实词 top N（多取，过滤后补齐）
    const zsetRaw = (await redis.zrevrange(
      HOT_KEY(safeLang),
      0,
      Math.max(safeLimit, 20) - 1,
      'WITHSCORES',
    )) as string[];
    const zsetScore = new Map<string, number>();
    const zsetWords: string[] = [];
    for (let i = 0; i < zsetRaw.length; i += 2) {
      const w = String(zsetRaw[i]);
      zsetWords.push(w);
      zsetScore.set(w, Number(zsetRaw[i + 1]));
    }

    const result: { word: string; searchCount: number }[] = [];
    // Why: seen 用 toLowerCase key 去重 - PINNED "Apple"（seed 大写）与 ZSET "apple"
    //   （recordSearch normalize 小写）算同词，避免热搜榜出现两个 apple
    const seen = new Set<string>();
    const push = (word: string): void => {
      const key = word.toLowerCase();
      if (result.length >= safeLimit) return;
      if (blocked.has(key) || seen.has(key)) return;
      // Why: searchCount 用 key 取（ZSET 是 normalize 小写 key，PINNED 大写转小写匹配真实 score）
      result.push({ word, searchCount: zsetScore.get(key) ?? 0 });
      seen.add(key);
    };
    pinned.forEach((p) => push(p.word));
    zsetWords.forEach((w) => push(w));
    if (result.length < safeLimit) {
      manual.forEach((m) => push(m.word));
    }
    return result;
  }

  /** admin：ZSET top N（含 searchCount，运营看真实热度，可跨语言） */
  async adminListHot(
    lang: string | undefined,
    limit: number,
  ): Promise<{ word: string; lang: string; searchCount: number }[]> {
    const langs = lang && SUPPORTED_LANGS.includes(lang) ? [lang] : SUPPORTED_LANGS;
    const out: { word: string; lang: string; searchCount: number }[] = [];
    for (const l of langs) {
      const rows = (await redis.zrevrange(HOT_KEY(l), 0, limit - 1, 'WITHSCORES')) as string[];
      for (let i = 0; i < rows.length; i += 2) {
        out.push({ word: String(rows[i]), lang: l, searchCount: Number(rows[i + 1]) });
      }
    }
    return out.sort((a, b) => b.searchCount - a.searchCount);
  }

  /** admin：运营种子词列表（HotSearchTerm 表） */
  async listTerms(lang?: string, type?: HotSearchTypeValue) {
    return db.hotSearchTerm.findMany({
      where: { ...(lang && { lang }), ...(type && { type }) },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createTerm(input: {
    word: string;
    lang: string;
    type: HotSearchTypeValue;
    sortOrder?: number;
    status?: string;
  }) {
    return db.hotSearchTerm.create({
      data: {
        word: input.word.trim().toLowerCase().slice(0, 50),
        lang: input.lang,
        type: input.type,
        sortOrder: input.sortOrder ?? 0,
        status: input.status ?? 'ACTIVE',
      },
    });
  }

  async updateTerm(
    id: string,
    input: Partial<{
      word: string;
      lang: string;
      type: HotSearchTypeValue;
      sortOrder: number;
      status: string;
    }>,
  ) {
    const existing = await db.hotSearchTerm.findUnique({ where: { id } });
    if (!existing)
      throw new NotFoundException({ code: 'E-SEARCH-001', message: 'Hot search term not found' });
    return db.hotSearchTerm.update({
      where: { id },
      data: {
        ...(input.word !== undefined && { word: input.word.trim().toLowerCase().slice(0, 50) }),
        ...(input.lang !== undefined && { lang: input.lang }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        ...(input.status !== undefined && { status: input.status }),
      },
    });
  }

  async deleteTerm(id: string): Promise<void> {
    const existing = await db.hotSearchTerm.findUnique({ where: { id } });
    if (!existing)
      throw new NotFoundException({ code: 'E-SEARCH-001', message: 'Hot search term not found' });
    await db.hotSearchTerm.delete({ where: { id } });
  }

  /** admin：零结果词聚合（SearchLog resultCount=0 GROUP BY word,lang，运营补商品依据） */
  async listZeroResult(lang?: string): Promise<{ word: string; lang: string; count: number }[]> {
    const rows = await db.searchLog.groupBy({
      by: ['word', 'lang'],
      where: { resultCount: 0, ...(lang && { lang }) },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 50,
    });
    return rows.map((r) => ({ word: r.word, lang: r.lang, count: r._count.id }));
  }
}
