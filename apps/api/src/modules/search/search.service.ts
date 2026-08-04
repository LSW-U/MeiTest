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

  /**
   * 搜索建议 / 输入联想（客户端 GET /client/search/suggest，C 方案词联想数据源）
   *
   * 三源合并去重（PINNED/MANUAL 词库 > Redis ZSET 真实词 > 商品名兜底），按 limit 截断。
   * BLOCKED 词全链路剔除（词库查询已排除 + ZSET/商品名 push 时再过滤一次防漏）。
   *
   * Why 三源：
   * - 词库前缀匹配：运营精选词（PINNED）+ 候选词（MANUAL），最相关
   * - ZSET 真实词：用户实际搜的词（recordSearch 写入），热度真实
   * - 商品名兜底：词库/ZSET 都没匹配时，从 ACTIVE 商品名派生词（命中率兜底）
   *
   * 降级：Redis 离线时 ZSET 取空（try/catch），词库 + 商品名仍工作（方案 §5.5）。
   */
  async suggest(
    prefix: string,
    lang: string,
    limit: number,
  ): Promise<{ word: string; searchCount: number }[]> {
    const safeLang = SUPPORTED_LANGS.includes(lang) ? lang : 'en';
    const safeLimit = Math.min(Math.max(limit, 1), 20);
    const normalizedPrefix = prefix.trim().toLowerCase();
    if (!normalizedPrefix) return [];

    // 词库（status=ACTIVE，含 BLOCKED 用于过滤；JS 分类 PINNED/MANUAL 做前缀匹配）
    const terms = await db.hotSearchTerm.findMany({
      where: { lang: safeLang, status: 'ACTIVE' },
    });
    const blocked = new Set(
      terms.filter((t) => t.type === 'BLOCKED').map((t) => t.word.toLowerCase()),
    );
    const prefixMatches = (t: { word: string }): boolean =>
      t.word.toLowerCase().startsWith(normalizedPrefix);
    const pinned = terms
      .filter((t) => t.type === 'PINNED' && prefixMatches(t))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const manual = terms
      .filter((t) => t.type === 'MANUAL' && prefixMatches(t))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // ZSET 真实词 top 50（多取，JS 前缀过滤）；redis 离线降级为空（方案 §5.5）
    const zsetScore = new Map<string, number>();
    try {
      const zsetRaw = (await redis.zrevrange(
        HOT_KEY(safeLang),
        0,
        49,
        'WITHSCORES',
      )) as string[];
      for (let i = 0; i < zsetRaw.length; i += 2) {
        const w = String(zsetRaw[i]);
        if (w.startsWith(normalizedPrefix)) {
          zsetScore.set(w, Number(zsetRaw[i + 1]));
        }
      }
    } catch (err) {
      // Redis 离线：ZSET 降级为空，词库 + 商品名仍工作（不阻塞 suggest）
      console.error('[suggest] redis zrevrange failed (non-fatal, ZSET degraded):', err);
    }

    // 商品名前缀匹配（raw ILIKE prefix%，当前 lang + en 兜底 — 前缀非包含）
    // Why 只匹配 lang + en（非全 5 语言）：返回 word 取 lang name ?? en name，
    //   若全 5 语言匹配会命中"pt=Arroz 但返 en=Rice"的词，用户看到非 prefix 开头的词困惑
    //   en 兜底覆盖 zh/id/pt/tet 没翻译的商品（en 是主语言）
    const pattern = `${normalizedPrefix}%`;
    const productRows = await db.$queryRaw<{ name: unknown }[]>`
      SELECT name FROM products
      WHERE status = 'ACTIVE'
        AND (name->>${safeLang} ILIKE ${pattern}
          OR name->>'en' ILIKE ${pattern})
      LIMIT ${safeLimit}
    `;
    const productNames = productRows
      .map((r) => {
        const name = r.name as Record<string, string> | null;
        // 优先 lang name（且 prefix 开头）；否则 en name（且 prefix 开头）
        // Why 二次过滤：SQL 匹配 lang OR en（en 兜底无翻译商品），但返回的 word 必须与 prefix 一致 —
        //   否则 lang=pt prefix=a 时 Apple 的 en="Apple" 命中却返 pt="Maçã"（M 开头）让用户困惑
        const langName = name?.[safeLang];
        if (langName && langName.toLowerCase().startsWith(normalizedPrefix)) return langName;
        const enName = name?.en;
        if (enName && enName.toLowerCase().startsWith(normalizedPrefix)) return enName;
        return null;
      })
      .filter((n): n is string => n !== null);

    // 合并去重（key = word.toLowerCase()）：词库 > ZSET > 商品名
    const seen = new Set<string>();
    const result: { word: string; searchCount: number }[] = [];
    const push = (word: string, count: number): void => {
      const key = word.toLowerCase();
      // BLOCKED 全链路过滤（ZSET/商品名也可能含敏感词，运营屏蔽意图）
      if (blocked.has(key) || seen.has(key) || result.length >= safeLimit) return;
      result.push({ word, searchCount: count });
      seen.add(key);
    };
    // 词库（PINNED 优先 + MANUAL，searchCount 取 ZSET 真实值 ?? 0）
    [...pinned, ...manual].forEach((t) =>
      push(t.word, zsetScore.get(t.word.toLowerCase()) ?? 0),
    );
    // ZSET 真实词（按 score 降序）
    [...zsetScore.entries()].sort((a, b) => b[1] - a[1]).forEach(([w, c]) => push(w, c));
    // 商品名兜底（searchCount = 0，无热搜数据）
    productNames.forEach((n) => push(n, 0));

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
