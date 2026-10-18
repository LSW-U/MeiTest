/**
 * Collaborative Filtering Service — 批6 协同过滤（2026-10-18）
 *
 * 方案：方案v2 §三 批6（E4 已拍板做；纯 SQL 共现统计，非 ML 模型）
 *
 * 架构：
 *   - 离线重算（recomputeAll，BullMQ processor 调用）：订单共现 → 用户相似度 top K 邻居
 *     → 邻居高频商品排除已购 → 物化写 similar_user_picks（全量 delete + batch insert）
 *   - 读路径（A9 getCustomersAlsoBought / B7 getSimilarSignal）：只读物化表，不现算（P6-2）
 *
 * 相似度口径（Jaccard 系数——共现统计最简可解释形态）：
 *   sim(u,v) = |买过商品交集| / |买过商品并集|（订单 status IN ('COMPLETED','CANCELLED')、
 *   不过滤 deletedAt，R-a 同源口径；窗口 similarityWindowDays 内）
 *
 * 可解释可回溯（P6-1）：每行物化 score + sourceCount（贡献邻居数）+ minScore（top 邻居
 * 最低分）+ computedAt；重算批次先 delete 旧行再 insert，行时间即批次时间。
 *
 * 隐私红线（P6-4）：A9 只出商品不出人——物化行不含邻居 userId 明细，端点响应无身份信息。
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { getCollaborativeConfig } from './collaborative.config';

/** 单买家用户对相似度贡献上限（防单一大买家主导——其并集大、Jaccard 天然低，无需额外惩罚） */

/** 重算结果摘要（processor 返回/日志用） */
export interface RecomputeResult {
  /** 参与计算的用户数（窗口内有购买） */
  users: number;
  /** 物化写入行数 */
  picks: number;
  /** 计算耗时 ms */
  elapsedMs: number;
}

@Injectable()
export class CollaborativeFilterService {
  /**
   * 离线全量重算（幂等：先删后插；失败时旧批次保留——delete 与 insert 在同一事务）
   *
   * 步骤：
   *   1) 窗口内用户-商品集（每用户买过商品列表）
   *   2) 用户两两 Jaccard（内存计算：用户数早期规模小，SQL 两两自 join 是 O(n²) 行展开，
   *      内存 Map 交集更可控；用户量超过阈值时靠 neighborTopK 截断输出侧）
   *   3) 每用户取 top K 邻居（≥ minNeighborScore）→ 邻居商品频次聚合（自身频次加权邻居相似度）
   *      → 排除已购 → 取 picksPerUser 条 → 证据字段（sourceCount/minScore）随行
   *   4) 事务：deleteMany 旧行 + createMany 新行
   */
  async recomputeAll(now: Date = new Date()): Promise<RecomputeResult> {
    const started = Date.now();
    const cfg = await getCollaborativeConfig();
    const since = new Date(now.getTime() - cfg.similarityWindowDays * 86_400_000);

    // 1) 窗口内用户-商品集（R-a 同源口径：不过滤 deletedAt）
    const rows = (await db.$queryRaw<
      { user_id: string; product_id: string }[]
    >`
      SELECT DISTINCT o.user_id, oi.product_id
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status IN ('COMPLETED', 'CANCELLED')
        AND o.created_at >= ${since}
    `) as { user_id: string; product_id: string }[];

    // 用户 → 商品集
    const userProducts = new Map<string, Set<string>>();
    for (const r of rows) {
      let set = userProducts.get(r.user_id);
      if (!set) {
        set = new Set();
        userProducts.set(r.user_id, set);
      }
      set.add(r.product_id);
    }

    // 2) 两两 Jaccard，每用户保留 top K 邻居
    const userIds = [...userProducts.keys()];
    const neighbors = new Map<string, Array<{ id: string; sim: number }>>();
    for (let i = 0; i < userIds.length; i++) {
      for (let j = i + 1; j < userIds.length; j++) {
        const a = userIds[i]!;
        const b = userIds[j]!;
        const sa = userProducts.get(a)!;
        const sb = userProducts.get(b)!;
        let inter = 0;
        for (const p of sa) if (sb.has(p)) inter++;
        if (inter === 0) continue;
        const union = sa.size + sb.size - inter;
        const sim = inter / union;
        if (sim < cfg.minNeighborScore) continue;
        this.pushNeighbor(neighbors, a, { id: b, sim }, cfg.neighborTopK);
        this.pushNeighbor(neighbors, b, { id: a, sim }, cfg.neighborTopK);
      }
    }

    // 3) 邻居商品聚合 → 排除已购 → 物化行
    const computedAt = now;
    const picks: {
      userId: string;
      productId: string;
      score: number;
      sourceCount: number;
      minScore: number;
      computedAt: Date;
    }[] = [];
    for (const [userId, nbs] of neighbors) {
      const own = userProducts.get(userId)!;
      // 邻居商品得分 = Σ 邻居相似度（邻居买过该商品即贡献其相似度权重）
      const productScores = new Map<string, { score: number; sources: number; min: number }>();
      for (const nb of nbs) {
        for (const pid of userProducts.get(nb.id)!) {
          if (own.has(pid)) continue; // 排除已购
          const cur = productScores.get(pid);
          if (cur) {
            cur.score += nb.sim;
            cur.sources += 1;
            cur.min = Math.min(cur.min, nb.sim);
          } else {
            productScores.set(pid, { score: nb.sim, sources: 1, min: nb.sim });
          }
        }
      }
      const ranked = [...productScores.entries()]
        .filter(([, v]) => v.sources >= cfg.minSourceCount)
        .sort((x, y) => y[1].score - x[1].score || y[1].sources - x[1].sources)
        .slice(0, cfg.picksPerUser);
      for (const [pid, v] of ranked) {
        picks.push({
          userId,
          productId: pid,
          // 归一：score 上界 = Σ邻居相似度，除以自身相似度和做 0-1 归一（可解释：最强邻居独占≈1）
          score: this.round6(v.score / nbs.reduce((s, n) => s + n.sim, 0)),
          sourceCount: v.sources,
          minScore: this.round6(v.min),
          computedAt,
        });
      }
    }

    // 4) 事务物化（全量替换；失败旧批次保留）
    await db.$transaction(async (tx) => {
      await tx.similarUserPick.deleteMany({});
      // createMany 分块（防单语句参数超限；500 行/块足够 picksPerUser×用户数 早期规模）
      for (let i = 0; i < picks.length; i += 500) {
        await tx.similarUserPick.createMany({ data: picks.slice(i, i + 500) });
      }
    });

    const elapsedMs = Date.now() - started;
    logger.info({
      msg: 'COLLABORATIVE_RECOMPUTE_DONE',
      users: userIds.length,
      picks: picks.length,
      elapsedMs,
    });
    return { users: userIds.length, picks: picks.length, elapsedMs };
  }

  /**
   * A9 数据源：用户物化推荐（读物化不现算，P6-2）。
   * 返回 productId + 证据字段；商品行组装与 ACTIVE 过滤在 catalog.service（card 组装同套）。
   */
  async getMaterializedPicks(
    userId: string,
    limit: number,
  ): Promise<Array<{ productId: string; score: number; sourceCount: number; minScore: number; computedAt: string }>> {
    const rows = await db.similarUserPick.findMany({
      where: { userId },
      orderBy: [{ score: 'desc' }, { sourceCount: 'desc' }],
      take: limit,
    });
    return rows.map((r) => ({
      productId: r.productId,
      score: r.score,
      sourceCount: r.sourceCount,
      minScore: r.minScore,
      computedAt: r.computedAt.toISOString(),
    }));
  }

  /**
   * B7 融合信号：当前用户的 picks 命中候选商品的信号分（0-1，无命中=缺失）。
   * P3-1 裁决（per-user 口径）：「相似用户信号」= 当前用户自己的物化 picks（其邻居共同
   * 高频商品）命中候选——是本用户个性化的相似人群信号，非全站热门度修正。
   * 匿名/该用户无 picks → 空 Map（融合安全降级为纯类目加权序）。
   * 单查询读物化（P6-2），供 catalog.getRecommendations 融合排序加权。
   */
  async getSimilarSignalMap(
    userId: string | null,
    productIds: string[],
  ): Promise<Map<string, number>> {
    if (!userId || productIds.length === 0) return new Map();
    const rows = (await db.$queryRaw<{ product_id: string; signal: number }[]>`
      SELECT product_id, AVG(score)::float8 AS signal
      FROM similar_user_picks
      WHERE user_id = ${userId}
        AND product_id IN (${Prisma.join(productIds)})
      GROUP BY product_id
    `) as { product_id: string; signal: number }[];
    return new Map(rows.map((r) => [r.product_id, r.signal]));
  }

  /** 邻居有序插入（保持 desc，截断 topK——避免全量排序内存放大） */
  private pushNeighbor(
    map: Map<string, Array<{ id: string; sim: number }>>,
    userId: string,
    nb: { id: string; sim: number },
    topK: number,
  ) {
    let arr = map.get(userId);
    if (!arr) {
      arr = [];
      map.set(userId, arr);
    }
    arr.push(nb);
    arr.sort((x, y) => y.sim - x.sim);
    if (arr.length > topK) arr.length = topK;
  }

  private round6(n: number): number {
    return Math.round(n * 1_000_000) / 1_000_000;
  }
}
