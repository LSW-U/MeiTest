/**
 * Rider Order History Service — 骑手订单历史（方案v2-20261009，R12 互斥口径）
 *
 * 批1（P1）：getHistory（§2.1 列表，三态全查 + 派生后过滤 + offset 分页）+ getTodayStats（§2.3，Dili 当日只算 completed）
 * 批2（P2）：getStatusCounts（§2.2 四值互斥）+ getDetail（§2.4 详情）
 *
 * R12 互斥口径（总指挥 20261009 拍板）：
 *   - cancelled：关联 Order CANCELLED（优先——即使 task 本身 DELIVERED/FAILED 也只计 cancelled）
 *   - transferred：task FAILED 且订单未取消
 *   - completed：task DELIVERED 且订单未取消
 *   - all = completed + cancelled + transferred（三者之和，tab 徽标不双计）
 *
 * 实测注记：当前库 99/99 FAILED 任务全部关联 CANCELLED 订单 → transferred 预期 0（A3 验收注明属预期非 bug）。
 *
 * 字段口径（§2.1 表 + v2 修订）：
 *   - income = order.deliveryFee（分，Q2 拍板「配送费收入」；Settlement 按日聚合无 orderId，按单对账不可行）
 *   - completedAt = deliveredAt（completed）/ updatedAt（cancelled/transferred），epoch ms
 *   - dropoffName = order.deliveryAddress.name（AddressSnapshot={name,phone,detail,lat,lng}，无 contactName——v2 修订 #2）
 *   - pickupName = warehouse.name.en（admin-deposit.service.ts:497 先例）→ 缺失回退 code
 *   - durationMinutes = pickedUpAt→deliveredAt 差值（分钟），任一缺失给 0（前端 >0 降级「—」）
 *   - distanceKm = pickup→dropoff Haversine（toView:1926 同款，(0,0) 哨兵拦截）→ 回退计费距离 → 兜底 0
 *
 * 归属校验：task.riderId ≠ 当前骑手 RiderProfile.id → 404 E-RIDER-001（不泄露他人任务存在性）。
 */
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { db } from '../../shared/db';
import { MARKET_TIMEZONE, getDaysAgoInTz } from '../../shared/datetime';
import type {
  RiderOrderHistoryItemType,
  RiderOrderHistoryQueryType,
  RiderOrderHistoryStatusCountsType,
  RiderOrderHistoryStatusType,
  RiderOrderTodayStatsType,
} from '@meimart/api-contract';
import { haversineDistanceKm, decimalToNumber } from '@meimart/shared-utils';
import type { DecimalLike } from '@meimart/shared-utils';

/** 详情/计数共用的任务查询 include（order 只 select 派生所需字段） */
const TASK_INCLUDE = {
  order: {
    select: {
      orderNo: true,
      status: true,
      deliveryFee: true,
      deliveryAddress: true,
      deliveryFeeBreakdown: true,
    },
  },
  warehouse: { select: { code: true, name: true } },
} as const;

/** delivery_tasks 查询结果的最小形状（service 内派生用，避免 any） */
interface TaskRow {
  id: string;
  status: string;
  riderId: string | null;
  pickupAddress: string;
  pickupLat: DecimalLike;
  pickupLng: DecimalLike;
  dropoffAddress: string;
  dropoffLat: DecimalLike;
  dropoffLng: DecimalLike;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  updatedAt: Date;
  order: {
    orderNo: string;
    status: string;
    deliveryFee: number;
    deliveryAddress: unknown;
    deliveryFeeBreakdown: unknown;
  } | null;
  warehouse: { code: string; name: unknown } | null;
}

@Injectable()
export class RiderOrderHistoryService {
  /** 按 user.sub（JWT）定位 RiderProfile（earnings.service.ts:47 同款；RIDER JWT 无 profile → 403） */
  private async resolveProfileId(userSub: string): Promise<string> {
    const profile = await db.riderProfile.findUnique({ where: { userId: userSub } });
    if (!profile) {
      throw new ForbiddenException({
        code: 'E-RIDER-001',
        message: `Rider profile not found for user: ${userSub}`,
      });
    }
    return profile.id;
  }

  /** R12 派生：task 状态 + 订单状态 → 三态之一；非终态且订单未取消 → null（不在历史范围） */
  private deriveStatus(taskStatus: string, orderStatus: string): RiderOrderHistoryStatusType | null {
    if (orderStatus === 'CANCELLED') return 'cancelled'; // 优先（R12）
    if (taskStatus === 'DELIVERED') return 'completed';
    if (taskStatus === 'FAILED') return 'transferred';
    return null;
  }

  /** task 行 → §2.1 条目（列表项 = 详情单对象共用） */
  private toItem(t: TaskRow): RiderOrderHistoryItemType {
    const status = this.deriveStatus(t.status, t.order?.status ?? '');
    // 派生恒非 null：调用方 where 已限定（三态全查）；防御性兜底按 transferred 之外不该出现 → 走 completedAt=updatedAt
    const completedAt =
      status === 'completed' ? (t.deliveredAt ?? t.updatedAt) : t.updatedAt;

    // durationMinutes：pickedUpAt→deliveredAt 差值（分钟），任一缺失给 0
    let durationMinutes = 0;
    if (t.pickedUpAt && t.deliveredAt) {
      durationMinutes = Math.max(0, Math.round((t.deliveredAt.getTime() - t.pickedUpAt.getTime()) / 60_000));
    }

    // distanceKm：Haversine（(0,0) 哨兵拦截，toView:1926 同款）→ 计费距离 → 0
    const pLat = decimalToNumber(t.pickupLat, 0);
    const pLng = decimalToNumber(t.pickupLng, 0);
    const dLat = decimalToNumber(t.dropoffLat, 0);
    const dLng = decimalToNumber(t.dropoffLng, 0);
    const hasCoords =
      [pLat, pLng, dLat, dLng].every(Number.isFinite) &&
      !(pLat === 0 && pLng === 0 && dLat === 0 && dLng === 0);
    const breakdown = t.order?.deliveryFeeBreakdown as { distanceKm?: number | null } | null;
    const distanceKm = hasCoords
      ? (haversineDistanceKm(pLat, pLng, dLat, dLng) ?? breakdown?.distanceKm ?? 0)
      : (breakdown?.distanceKm ?? 0);

    // dropoffName：order.deliveryAddress.name（无 contactName——v2 修订 #2；历史快照可能缺 → ''）
    const dropoffName = (t.order?.deliveryAddress as { name?: string } | null)?.name ?? '';
    // pickupName：warehouse.name.en（多语 JSON）→ 回退 code
    const warehouseName = (t.warehouse?.name as Record<string, string> | null)?.en ?? '';
    const pickupName = warehouseName || t.warehouse?.code || '';

    return {
      id: t.id,
      orderNo: t.order?.orderNo ?? '',
      status: status ?? 'transferred',
      completedAt: completedAt.getTime(),
      pickupName,
      pickupAddress: t.pickupAddress,
      dropoffName,
      dropoffAddress: t.dropoffAddress,
      income: t.order?.deliveryFee ?? 0,
      distanceKm,
      durationMinutes,
    };
  }

  /**
   * 状态计数（§2.2，R12 互斥口径）
   *
   * 实现：三态全查（DELIVERED / FAILED / 关联订单 CANCELLED）取回最小集后在内存派生计数——
   * 单骑手终态任务量级小（实测 <150 行），避免 groupBy + 二次查询的口径分裂；
   * 与 history 列表（批1）共用同一派生函数，保证 tab 徽标与列表严格一致。
   */
  async getStatusCounts(userSub: string): Promise<RiderOrderHistoryStatusCountsType> {
    const profileId = await this.resolveProfileId(userSub);
    const tasks = (await db.deliveryTask.findMany({
      where: {
        riderId: profileId,
        OR: [{ status: 'DELIVERED' }, { status: 'FAILED' }, { order: { status: 'CANCELLED' } }],
      },
      select: { status: true, order: { select: { status: true } } },
    })) as Array<{ status: string; order: { status: string } | null }>;

    let completed = 0;
    let cancelled = 0;
    let transferred = 0;
    for (const t of tasks) {
      const s = this.deriveStatus(t.status, t.order?.status ?? '');
      if (s === 'completed') completed += 1;
      else if (s === 'cancelled') cancelled += 1;
      else if (s === 'transferred') transferred += 1;
    }
    return { all: completed + cancelled + transferred, completed, cancelled, transferred };
  }

  /**
   * 订单详情（§2.4）：路径参数 = delivery task id，响应 = §2.1 单对象。
   *
   * 归属校验：不存在 / 不属于当前骑手 → 404 E-RIDER-001（dispatch.service.ts:1888 同语义，
   * 不区分「不存在」与「非本人」以免泄露任务存在性）。
   * 非历史范围的任务（非终态且订单未取消，如进行中任务）同样 404——详情页只从 history 列表进入，
   * 进行中任务走既有 /rider/dispatch/my-tasks 链路。
   */
  async getDetail(userSub: string, taskId: string): Promise<RiderOrderHistoryItemType> {
    const profileId = await this.resolveProfileId(userSub);
    const t = (await db.deliveryTask.findFirst({
      where: { id: taskId, riderId: profileId },
      include: TASK_INCLUDE,
    })) as TaskRow | null;
    if (!t) {
      throw new NotFoundException({
        code: 'E-RIDER-001',
        message: 'Task not found in order history',
      });
    }
    const status = this.deriveStatus(t.status, t.order?.status ?? '');
    if (!status) {
      throw new NotFoundException({
        code: 'E-RIDER-001',
        message: 'Task not found in order history',
      });
    }
    return this.toItem(t);
  }

  /**
   * 订单历史列表（§2.1，批1）：三态全查 → 内存派生 → 派生后过滤 → 排序 → offset 分页。
   *
   * - where 三态全查（DELIVERED / FAILED / 关联订单 CANCELLED），与 status-counts 同条件；
   * - query.status 过滤在派生映射后做（任务书纪律：不透传 Prisma 枚举，R12 口径）；
   * - 排序按派生完成时间 completedAt 倒序（completed=deliveredAt，其余=updatedAt，§2.1）；
   * - 分页在派生过滤后内存切片——单骑手终态任务量级小（实测 <150 行，与 status-counts
   *   同量级判断），避免「Prisma 分页 + 内存过滤」导致的每页条数不齐。
   */
  async getHistory(
    userSub: string,
    query: RiderOrderHistoryQueryType,
  ): Promise<{
    items: RiderOrderHistoryItemType[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const profileId = await this.resolveProfileId(userSub);
    const tasks = (await db.deliveryTask.findMany({
      where: {
        riderId: profileId,
        OR: [{ status: 'DELIVERED' }, { status: 'FAILED' }, { order: { status: 'CANCELLED' } }],
      },
      include: TASK_INCLUDE,
    })) as TaskRow[];

    // 派生 + 派生后过滤（status 参数是 R12 三态，不是 Prisma 枚举）
    let items = tasks
      .map((t) => ({ t, status: this.deriveStatus(t.status, t.order?.status ?? '') }))
      .filter((x): x is { t: TaskRow; status: RiderOrderHistoryStatusType } => x.status !== null);
    if (query.status) {
      items = items.filter((x) => x.status === query.status);
    }

    // completedAt 倒序（completed=deliveredAt；cancelled/transferred=updatedAt，§2.1）
    items.sort(
      (a, b) =>
        (b.status === 'completed' ? (b.t.deliveredAt ?? b.t.updatedAt) : b.t.updatedAt).getTime() -
        (a.status === 'completed' ? (a.t.deliveredAt ?? a.t.updatedAt) : a.t.updatedAt).getTime(),
    );

    const total = items.length;
    const paged = items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    return {
      items: paged.map((x) => this.toItem(x.t)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * 今日统计（§2.3，批1）：Dili 当日 completed 任务数 + 配送费收入合计（分）。
   *
   * 时区：复用 shared/datetime getDaysAgoInTz(0, MARKET_TIMEZONE) 取 Dili 当日
   * YYYY-MM-DD，再构 UTC 午夜边界（earnings.service diliDateN 同款，不手写 UTC+9 offset）。
   * 口径：count 与 totalIncome 同源同条件（只算 completed），与 history 列表/status-counts
   * 的 completed 派生一致（R12）。
   */
  async getTodayStats(userSub: string): Promise<RiderOrderTodayStatsType> {
    const profileId = await this.resolveProfileId(userSub);
    // Dili 当日 00:00（UTC instant）；上界 = +24h（Dili 无夏令时）
    const dayStart = new Date(`${getDaysAgoInTz(0, MARKET_TIMEZONE)}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

    const tasks = (await db.deliveryTask.findMany({
      where: {
        riderId: profileId,
        status: 'DELIVERED',
        deliveredAt: { gte: dayStart, lt: dayEnd },
        // 防御：deliveredAt 落在今日但订单已取消 → R12 口径归 cancelled，不计 completed
        order: { status: { not: 'CANCELLED' } },
      },
      select: { order: { select: { deliveryFee: true } } },
    })) as Array<{ order: { deliveryFee: number } | null }>;

    return {
      count: tasks.length,
      totalIncome: tasks.reduce((sum, t) => sum + (t.order?.deliveryFee ?? 0), 0),
    };
  }
}
