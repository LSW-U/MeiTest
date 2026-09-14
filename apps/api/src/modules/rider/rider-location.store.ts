/**
 * Rider Location Store — 骑手实时位置 Redis 落点（真实环境接入批B，R10）
 *
 * 方案：方案v2-真实环境接入专项Real-Connect-20260914 §1 R10 / §3 批B
 *
 * 设计（R10 拍板口径）：
 *   - 写 `rider:loc:{riderId}` = JSON `{lat,lng,ts,orderId?}`（value 一次定死）
 *   - key 中 riderId = JWT sub（User.id）——WS handshake 与 HTTP report 的 user.sub 同源
 *   - TTL ≈ 上报间隔×3：配送中 5s→约 90s、等单 15s→约 2min（env 可配）；
 *     TTL 取最后一次上报时的状态（orderId 有无），接单切频时自然刷新，不需动态改 TTL
 *   - ts 用服务端接收时间（客户端 ts 仅展示/调试，防端上时钟漂移）
 *   - 读时统一新鲜度阈值 RIDER_LOC_FRESH_SEC（固定 2min）二次校验（防 Redis 惰性删除延迟）
 *   - 已知骑手集合 MGET 批量取（禁循环单 GET）；Redis 异常回退 null（中点兜底，不新增故障模式）
 *
 * 与 `rider:online:{userId}`（rider.service heartbeat 维护，SET 60s）的语义差异：
 *   - rider:online 是「在线心跳」：60s TTL，heartbeat 每次续期，过期=骑手客户端失联（不可派）
 *   - rider:loc 是「位置快照」：TTL≈上报间隔×3，过期=「多久没上报位置」（坐标不新鲜，
 *     距离分回退中点）——两者独立维护，在线≠有新鲜坐标（后台等单骑手在线但不上报，R22）
 *
 * 升级路径（R10 留一句）：未来「按半径反查骑手」场景在本模块写点补 GEOADD 即可，
 * 打分（已知集合内算距离）用 SET+TTL 已够，不引 Redis GEO / PostGIS（不做清单）。
 */
import { redis } from '../../shared/cache';
import { logger } from '../../shared/logger/logger';

/** Redis key 前缀（redis.ts Proxy 自动加 meimart: 前缀，此处不含） */
export const RIDER_LOC_KEY_PREFIX = 'rider:loc:';

/**
 * 读侧统一新鲜度阈值（秒，固定值，评审二轮 P1-3）：
 * 同一时刻所有骑手用同一条「新鲜」标准（≠分档 TTL——写侧 TTL 取上报时状态，
 * 读侧必须一致，否则同一刻两个骑手标准不同）。
 */
export const RIDER_LOC_FRESH_SEC = 120;

/** 配送中 TTL（秒）：上报间隔 5s × 约 3 → 90s（env RIDER_LOC_TTL_DELIVERY_SEC 可配） */
export function riderLocTtlDeliverySec(): number {
  const n = Number(process.env.RIDER_LOC_TTL_DELIVERY_SEC);
  return Number.isFinite(n) && n > 0 ? n : 90;
}

/** 等单 TTL（秒）：上报间隔 15s × 约 3 → 2min（env RIDER_LOC_TTL_IDLE_SEC 可配） */
export function riderLocTtlIdleSec(): number {
  const n = Number(process.env.RIDER_LOC_TTL_IDLE_SEC);
  return Number.isFinite(n) && n > 0 ? n : 120;
}

/** `rider:loc:{riderId}` 位置快照值（ts=服务端接收时间 ms） */
export interface RiderLocValue {
  lat: number;
  lng: number;
  /** 服务端接收时间（ms）；客户端 ts 仅展示/调试 */
  ts: number;
  /** 最后一次上报时的状态：配送中带 orderId，等单缺省（R10 value 一次定死） */
  orderId?: string;
}

/** 拼 Redis key（导出供单测/读侧对齐） */
export function riderLocKey(riderId: string): string {
  return `${RIDER_LOC_KEY_PREFIX}${riderId}`;
}

/**
 * 落点（两通道收敛：WS handleLocationUpdate + HTTP /rider/location/report 都调这里）
 *
 * - 失败仅 warn 不抛：落存储是旁路增强，不阻塞上报主链路（广播/响应照常）
 * - TTL 按「本次上报时是否配送中」选择（R10：接单切频自然刷新）
 */
export async function persistRiderLocation(
  riderId: string,
  lat: number,
  lng: number,
  orderId?: string,
): Promise<void> {
  const value: RiderLocValue = {
    lat,
    lng,
    ts: Date.now(),
    ...(orderId ? { orderId } : {}),
  };
  const ttl = orderId ? riderLocTtlDeliverySec() : riderLocTtlIdleSec();
  try {
    await redis.set(riderLocKey(riderId), JSON.stringify(value), 'EX', ttl);
  } catch (err) {
    logger.warn({
      msg: 'RIDER_LOC_PERSIST_FAILED',
      riderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * 批量读骑手位置（已知骑手集合，MGET 一次 round-trip，禁循环单 GET）
 *
 * 返回 { locs, redisError }：
 *   - locs：userId → 值。仅含「存在且 JSON 可解析」的键；
 *     新鲜度判定（ts 过期）由调用方按 RIDER_LOC_FRESH_SEC 二次校验（读时校验与
 *     计数分桶在 dispatch 侧完成，本函数保持纯读取）。
 *   - redisError：Redis 异常标记（R17 分桶用）；此时 locs 为空 Map，
 *     调用方全员回退 null 中点兜底，不新增故障模式。
 */
export async function fetchRiderLocations(
  userIds: string[],
): Promise<{ locs: Map<string, RiderLocValue>; redisError: boolean }> {
  if (userIds.length === 0) return { locs: new Map(), redisError: false };
  try {
    const values = await redis.mget(...userIds.map((u) => riderLocKey(u)));
    const result = new Map<string, RiderLocValue>();
    userIds.forEach((userId, i) => {
      const raw = values[i];
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as RiderLocValue;
        if (
          typeof parsed?.lat === 'number' &&
          typeof parsed?.lng === 'number' &&
          typeof parsed?.ts === 'number'
        ) {
          result.set(userId, parsed);
        }
      } catch {
        // 值损坏视为缺失（走 missing 分桶），不抛
      }
    });
    return { locs: result, redisError: false };
  } catch (err) {
    logger.warn({
      msg: 'RIDER_LOC_MGET_FAILED',
      count: userIds.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return { locs: new Map(), redisError: true };
  }
}

/**
 * R17 可观测计数（命中率/过期率/MGET 缺失率）——读侧分桶
 *
 * 零新增表（R17 口径）：进程内计数 + 每次候选打分读后一条结构化日志，
 * listDispatchCandidates 是 admin 低频操作，逐次日志量可接受；
 * 后续接指标体系时从日志聚合即可。
 */
export interface RiderLocReadMetrics {
  /** 命中（键存在且新鲜，真实距离分生效） */
  hit: number;
  /** 过期（键存在但 ts 超新鲜度阈值；值损坏在 fetch 阶段已过滤，落 missing 桶） */
  expired: number;
  /** MGET 缺失（键不存在——骑手从未上报或 TTL 已到） */
  missing: number;
  /** Redis 异常（整批回退空 Map） */
  redisError: number;
}

/** 按新鲜度阈值分桶（hit/expired/missing/redisError），并输出一条结构化日志 */
export function bucketRiderLocReadMetrics(
  userIds: string[],
  locs: Map<string, RiderLocValue>,
  now: number,
  redisError: boolean,
): RiderLocReadMetrics {
  const metrics: RiderLocReadMetrics = { hit: 0, expired: 0, missing: 0, redisError: redisError ? 1 : 0 };
  for (const userId of userIds) {
    const loc = locs.get(userId);
    if (!loc) {
      metrics.missing += 1;
    } else if (now - loc.ts > RIDER_LOC_FRESH_SEC * 1000) {
      metrics.expired += 1;
    } else {
      metrics.hit += 1;
    }
  }
  logger.info({
    msg: 'RIDER_LOC_READ_METRICS',
    ...metrics,
    total: userIds.length,
    // 命中率/过期率/缺失率（R17 三计数，比率便于直接消费）
    hitRate: userIds.length ? Number((metrics.hit / userIds.length).toFixed(3)) : 0,
    expiredRate: userIds.length ? Number((metrics.expired / userIds.length).toFixed(3)) : 0,
    missingRate: userIds.length ? Number((metrics.missing / userIds.length).toFixed(3)) : 0,
  });
  return metrics;
}
