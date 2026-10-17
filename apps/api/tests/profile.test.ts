/**
 * Profile 模块单测（客户画像批1 2026-10-18）
 *
 * 覆盖 P1 自检对应的六类断言：
 *   1. RFM 阈值边界（恰好达门槛归属：R=sleepingDays 不沉睡，R=sleepingDays+1 沉睡等）
 *   2. 生命周期流转含回退（常客→沉睡→流失→回购回 ACTIVE）
 *   3. 口径对账（getCustomerProfile360 各维共享同一 WHERE 口径，聚合数对账）
 *   4. 审计触发（getProfile360 查看 → VIEW_CUSTOMER_PROFILE AuditLog 落行）
 *   5. 403（controller @Roles('SUPER_ADMIN') 元数据 + roles.guard 拒非 admin）
 *   6. birthDate 可空（schema 现状断言——migration 已 deploy，此处防回退到必填）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

// ===== profile.config：mock db（getProfileThresholds 读 SystemConfig）=====
const m = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  userFindUnique: vi.fn(),
  orderFindMany: vi.fn(),
  systemConfigFindUnique: vi.fn(),
  auditLogCreate: vi.fn(),
  noteFindMany: vi.fn(),
  noteCreate: vi.fn(),
  noteFindFirst: vi.fn(),
  noteUpdate: vi.fn(),
  noteDelete: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({
  db: {
    $queryRaw: m.queryRaw,
    user: { findUnique: m.userFindUnique },
    order: { findMany: m.orderFindMany },
    systemConfig: { findUnique: m.systemConfigFindUnique },
    auditLog: { create: m.auditLogCreate },
    customerNote: {
      findMany: m.noteFindMany,
      create: m.noteCreate,
      findFirst: m.noteFindFirst,
      update: m.noteUpdate,
      delete: m.noteDelete,
    },
  },
}));

vi.mock('../src/shared/logger/logger', () => ({
  logger: { warn: m.loggerWarn, info: vi.fn(), error: vi.fn() },
}));

import { getLifecycleStage } from '../src/modules/profile/lifecycle';
import {
  parseProfileThresholds,
  PROFILE_THRESHOLDS,
  resetProfileThresholdsCacheForTest,
} from '../src/modules/profile/profile.config';
import { ProfileService } from '../src/modules/profile/profile.service';
import { AdminProfileController } from '../src/modules/profile/admin-profile.controller';
import { RolesGuard } from '../src/shared/guards/roles.guard';

// ============================================================================
// 1 + 2. 生命周期阶段机：阈值边界 + 流转含回退
// ============================================================================

const T = { repeatThreshold: 3, sleepingDays: 30, churnedDays: 90 };

describe('lifecycle 阶段机 — 阈值边界（P1-1/P1-4）', () => {
  it('F=0 → NEW（无论 R）', () => {
    expect(getLifecycleStage(0, null, T)).toBe('NEW');
    expect(getLifecycleStage(0, 999, T)).toBe('NEW');
  });

  it('F=1 → FIRST_PURCHASE（未超期）', () => {
    expect(getLifecycleStage(1, 0, T)).toBe('FIRST_PURCHASE');
    expect(getLifecycleStage(1, 30, T)).toBe('FIRST_PURCHASE');
  });

  it('R 边界：R=30（=sleepingDays）不沉睡；R=31 沉睡；R=91 流失', () => {
    expect(getLifecycleStage(5, 30, T)).toBe('ACTIVE');
    expect(getLifecycleStage(5, 31, T)).toBe('SLEEPING');
    expect(getLifecycleStage(5, 90, T)).toBe('SLEEPING');
    expect(getLifecycleStage(5, 91, T)).toBe('CHURNED');
  });

  it('F=2（repeatThreshold-1）未超期 → FIRST_PURCHASE（复购萌芽段）', () => {
    expect(getLifecycleStage(2, 5, T)).toBe('FIRST_PURCHASE');
  });

  it('F=3（=repeatThreshold）→ ACTIVE（恰好达门槛算常客）', () => {
    expect(getLifecycleStage(3, 5, T)).toBe('ACTIVE');
  });

  it('自定义阈值生效（G5 可配）：repeatThreshold=2 时 F=2 即 ACTIVE', () => {
    expect(getLifecycleStage(2, 5, { repeatThreshold: 2, sleepingDays: 30, churnedDays: 90 })).toBe(
      'ACTIVE',
    );
  });

  it('rDays=null 但 F>0 → 视为 R=0（不误判沉睡）', () => {
    expect(getLifecycleStage(3, null, T)).toBe('ACTIVE');
  });
});

describe('lifecycle 阶段机 — 流转含回退（P1-1）', () => {
  it('常客→沉睡→流失 顺向流转', () => {
    const active = getLifecycleStage(5, 3, T);
    const sleeping = getLifecycleStage(5, 45, T);
    const churned = getLifecycleStage(5, 120, T);
    expect([active, sleeping, churned]).toEqual(['ACTIVE', 'SLEEPING', 'CHURNED']);
  });

  it('回退：流失客回购 → R 归零 → 回 ACTIVE（同一函数即时判定）', () => {
    const churned = getLifecycleStage(5, 120, T);
    const recovered = getLifecycleStage(5, 0, T);
    expect(churned).toBe('CHURNED');
    expect(recovered).toBe('ACTIVE');
  });
});

// ============================================================================
// profile.config：解析回退
// ============================================================================

describe('parseProfileThresholds — 回退语义（G5）', () => {
  beforeEach(() => resetProfileThresholdsCacheForTest());

  it('null/空 → 代码常量', () => {
    expect(parseProfileThresholds(null)).toEqual(PROFILE_THRESHOLDS);
    expect(parseProfileThresholds(undefined)).toEqual(PROFILE_THRESHOLDS);
    expect(parseProfileThresholds('')).toEqual(PROFILE_THRESHOLDS);
  });

  it('非法 JSON → 回退 + 告警', () => {
    expect(parseProfileThresholds('{not json')).toEqual(PROFILE_THRESHOLDS);
    expect(m.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'PROFILE_THRESHOLDS_PARSE_FALLBACK' }),
    );
  });

  it('churnedDays ≤ sleepingDays → 回退（交叉校验）', () => {
    const bad = JSON.stringify({ repeatThreshold: 3, sleepingDays: 90, churnedDays: 30 });
    expect(parseProfileThresholds(bad)).toEqual(PROFILE_THRESHOLDS);
  });

  it('合法配置 → 生效', () => {
    const ok = JSON.stringify({ repeatThreshold: 5, sleepingDays: 14, churnedDays: 60 });
    expect(parseProfileThresholds(ok)).toEqual({
      repeatThreshold: 5,
      sleepingDays: 14,
      churnedDays: 60,
    });
  });
});

// ============================================================================
// 3. ProfileService 口径对账
// ============================================================================

/** 模拟 RFM 单扫聚合 SQL 返回行 */
function rfmRow(over: Partial<Record<string, unknown>> = {}) {
  return [
    {
      f_count: 4n,
      m_total: 12300n,
      first_at: new Date('2026-09-01T02:00:00Z'),
      last_at: new Date('2026-10-17T02:00:00Z'),
      discount_order_count: 2n,
      discount_total: 800n,
      ...over,
    },
  ];
}

describe('ProfileService.getCustomerProfile360 — 口径对账（P1-1）', () => {
  let service: ProfileService;

  beforeEach(() => {
    vi.resetAllMocks();
    resetProfileThresholdsCacheForTest();
    service = new ProfileService();
    m.userFindUnique.mockResolvedValue({ id: 'u-1' });
    m.systemConfigFindUnique.mockResolvedValue(null); // 无配置 → 代码常量
  });

  it('用户不存在 → E-PROFILE-001 404', async () => {
    m.userFindUnique.mockResolvedValue(null);
    await expect(service.getCustomerProfile360('nope')).rejects.toMatchObject({
      response: { code: 'E-PROFILE-001' },
    });
  });

  it('各维共享同一聚合基数：F(=f_count) 与 discountSensitivity.totalOrderCount 对账一致', async () => {
    m.queryRaw.mockImplementation(async (_: unknown, __?: unknown) => {
      // 按调用序：rfm → category → price → hours → addresses（Promise.all 并发但 mock 顺序固定）
      return rfmRow();
    });
    m.orderFindMany.mockResolvedValue([]);

    const data = await service.getCustomerProfile360('u-1', 'en');

    // 口径对账核心断言：RFM 的 F 与折扣敏感度 totalOrderCount 同源
    expect(data.rfm.fCount).toBe(4);
    expect(data.discountSensitivity.totalOrderCount).toBe(4);
    expect(data.discountSensitivity.discountOrderCount).toBe(2);
    expect(data.discountSensitivity.ratio).toBeCloseTo(0.5);
    // lifecycle 由 F/R 推导（阈值 3 → ACTIVE）
    expect(data.lifecycle.stage).toBe('ACTIVE');
  });

  it('P2-1：rfm 白名单输出——响应不含 _discountMeta 等内部字段', async () => {
    m.queryRaw.mockResolvedValue(rfmRow());
    m.orderFindMany.mockResolvedValue([]);

    const data = await service.getCustomerProfile360('u-1', 'en') as Record<string, unknown>;

    // rfm 只含契约五字段
    expect(Object.keys(data.rfm as object).sort()).toEqual(
      ['fCount', 'firstPurchaseAt', 'lastPurchaseAt', 'mTotal', 'rDays'],
    );
    // 全响应不含下划线内部字段
    expect(JSON.stringify(data)).not.toContain('_discountMeta');
  });

  it('P1-1：peakHours SQL 时区转换两段链（UTC → Asia/Dili，方向不得反）', async () => {
    m.queryRaw.mockResolvedValue(rfmRow());
    m.orderFindMany.mockResolvedValue([]);

    await service.getCustomerProfile360('u-1', 'en');

    // 找到 peakHours 那次调用（含 EXTRACT(HOUR）
    for (let i = 0; i < 5; i++) {
      const args = m.queryRaw.mock.calls[i] as unknown[];
      const tpl = args[0] as unknown as string[];
      const text = tpl.join(' ');
      if (!text.includes('EXTRACT(HOUR')) continue;
      // 正确方向：先声明基线 UTC，再转目标时区（单段 AT TIME ZONE 是「当作本地墙钟」语义，方向反）
      expect(text).toContain("AT TIME ZONE 'UTC' AT TIME ZONE");
      return;
    }
    throw new Error('peakHours query not found');
  });

  it('SQL 状态口径：RFM 查询含 COMPLETED+CANCELLED、不排除软删（R-a 同源红线）', async () => {
    m.queryRaw.mockResolvedValue(rfmRow());
    m.orderFindMany.mockResolvedValue([]);

    await service.getCustomerProfile360('u-1', 'en');

    // 5 次 $queryRaw（rfm/category/price/hours/addresses）全部应含同口径 status 字面量
    expect(m.queryRaw).toHaveBeenCalledTimes(5);
    for (let i = 0; i < 5; i++) {
      // tagged template：首参是字符串段数组，status 字面量经 Prisma.raw 作为插值参数传入
      const args = m.queryRaw.mock.calls[i] as unknown[];
      const tpl = args[0] as unknown as string[];
      const text = tpl.join(' ');
      const prismaRawVals = args
        .slice(1)
        .flatMap((a) => {
          // Prisma.raw 产物：{ values, strings: [SQL 字面量] } 对象（单插值时 strings[0] 即原文）
          const raw = a as { strings?: string[]; values?: unknown[] };
          if (Array.isArray(raw?.strings)) return raw.strings;
          return [JSON.stringify(a as object) ?? String(a ?? '')];
        });
      const allSql = text + ' ' + prismaRawVals.join(' ');
      expect(allSql).toContain("'COMPLETED', 'CANCELLED'");
      expect(allSql).not.toContain('deleted_at');
    }
  });

  it('无购买 → rDays/lastPurchaseAt/firstPurchaseAt null、ratio null、stage NEW', async () => {
    m.queryRaw.mockResolvedValue([
      {
        f_count: 0n,
        m_total: 0n,
        first_at: null,
        last_at: null,
        discount_order_count: 0n,
        discount_total: 0n,
      },
    ]);
    m.orderFindMany.mockResolvedValue([]);

    const data = await service.getCustomerProfile360('u-1', 'en');
    expect(data.rfm.rDays).toBeNull();
    expect(data.rfm.lastPurchaseAt).toBeNull();
    expect(data.rfm.firstPurchaseAt).toBeNull();
    expect(data.discountSensitivity.ratio).toBeNull();
    expect(data.lifecycle.stage).toBe('NEW');
  });
});

// ============================================================================
// 4. AdminProfileController：查看即审计 + notes CRUD 传递
// ============================================================================

function makeController(): AdminProfileController {
  const svc = {
    getCustomerProfile360: vi.fn().mockResolvedValue({ rfm: { fCount: 1 } }),
  } as never;
  const notes = {
    list: vi.fn().mockResolvedValue({ items: [] }),
    create: vi.fn().mockResolvedValue({ id: 'n-1' }),
    update: vi.fn().mockResolvedValue({ id: 'n-1' }),
    remove: vi.fn().mockResolvedValue({ id: 'n-1' }),
  } as never;
  return new AdminProfileController(svc, notes);
}

function makeReq(over: Record<string, unknown> = {}) {
  return {
    user: { sub: 'admin-1', role: 'SUPER_ADMIN' },
    headers: { 'accept-language': 'zh', 'x-perspective': 'platform', 'user-agent': 'UA/1' },
    ip: '10.0.0.1',
    ...over,
  } as never;
}

describe('AdminProfileController — 查看即审计（P1-2）', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.auditLogCreate.mockResolvedValue({});
  });

  it('getProfile360 → 异步落 VIEW_CUSTOMER_PROFILE 审计（userId=查看者, resourceId=目标）', async () => {
    const controller = makeController();
    const res = await controller.getProfile360(makeReq(), 'target-u');

    // 响应结构 + 审计断言
    expect(res).toEqual({ success: true, data: { rfm: { fCount: 1 } } });
    // fire-and-forget：等微任务冲刷
    await new Promise((r) => setTimeout(r, 0));
    expect(m.auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'admin-1',
        action: 'VIEW_CUSTOMER_PROFILE',
        resourceType: 'CustomerProfile',
        resourceId: 'target-u',
        deviceType: 'ADMIN_WEB',
        perspective: 'platform',
        ip: '10.0.0.1',
        userAgent: 'UA/1',
      }),
    });
  });

  it('审计写失败不阻塞查看（catch → warn）', async () => {
    m.auditLogCreate.mockRejectedValue(new Error('db down'));
    const controller = makeController();
    const res = await controller.getProfile360(makeReq(), 'target-u');
    expect(res).toEqual({ success: true, data: { rfm: { fCount: 1 } } });
    await new Promise((r) => setTimeout(r, 0));
    expect(m.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'profile_view_audit_write_failed' }),
    );
  });

  it('create/update/delete 把 req.user.sub 作操作人传给 notes service（P1-5）', async () => {
    const controller = makeController();
    await controller.createNote(makeReq(), 'u-1', { type: 'VIP', content: '高价值' });
    expect(
      (controller as unknown as { notes: { create: ReturnType<typeof vi.fn> } }).notes.create,
    ).toHaveBeenCalledWith('u-1', { type: 'VIP', content: '高价值' }, 'admin-1');
    await controller.updateNote(makeReq(), 'u-1', 'n-1', { content: '改' });
    await controller.deleteNote(makeReq(), 'u-1', 'n-1');
    const notesSvc = (controller as unknown as { notes: Record<string, ReturnType<typeof vi.fn>> })
      .notes;
    expect(notesSvc.update).toHaveBeenCalledWith('u-1', 'n-1', { content: '改' }, 'admin-1');
    expect(notesSvc.remove).toHaveBeenCalledWith('u-1', 'n-1', 'admin-1');
  });
});

// ============================================================================
// 5. Roles 守卫：403（P1-3）
// ============================================================================

describe('RolesGuard — profile controller 门控（P1-3）', () => {
  it('controller 元数据声明 SUPER_ADMIN', () => {
    const roles = Reflect.getMetadata('roles', AdminProfileController);
    expect(roles).toEqual(['SUPER_ADMIN']);
  });

  it('非 SUPER_ADMIN 请求 → ForbiddenException（403）', () => {
    const guard = new RolesGuard(new (class {
      getAllAndOverride = (key: string) => (key === 'roles' ? ['SUPER_ADMIN'] : undefined);
    })() as never);
    const handler = () => {};
    const mockContext = (role: string) =>
      ({
        getHandler: () => handler,
        getClass: () => AdminProfileController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { sub: 'x', role }, headers: {}, ip: '1' }),
        }),
      }) as never;

    expect(() => guard.canActivate(mockContext('CUSTOMER'))).toThrow();
    expect(() => guard.canActivate(mockContext('RIDER'))).toThrow();
    // SUPER_ADMIN 放行
    expect(guard.canActivate(mockContext('SUPER_ADMIN'))).toBe(true);
  });
});

// ============================================================================
// 6. birthDate 可空（P1-6 / G8）：schema 源文件断言防回退
// ============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// P1-1 附加：时区转换方向单测（固定 UTC 时刻 → Dili 本地时段，JS 侧等价验证）
// SQL 侧 `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dili'` 语义 = JS
// `Intl.DateTimeFormat(timeZone: 'Asia/Dili')` 对同一 UTC 时刻取小时。
// ============================================================================

describe('Dili 时区转换方向（P1-1）— 固定 UTC 时刻断言本地时段', () => {
  // 佐证审查例证：UTC 2026-10-16 14:17 → Dili 墙钟 23:17（UTC+9）→ hour 23
  it('UTC 14:17 → Dili hour 23（不是 5，方向反了才是 5）', () => {
    const utc = new Date('2026-10-16T14:17:26Z');
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Dili',
        hour: '2-digit',
        hour12: false,
      }).format(utc),
    );
    expect(hour).toBe(23);
  });

  it('UTC 16:00 → Dili 次日 01:00 → hour 1（跨日正确）', () => {
    const utc = new Date('2026-10-16T16:00:00Z');
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Dili',
        hour: '2-digit',
        hour12: false,
      }).format(utc),
    );
    expect(hour).toBe(1);
  });
});

describe('G8 User.birthDate 可空（schema 断言）', () => {
  it('birthDate 是 DateTime?（可空），migration 语句无 NOT NULL', () => {
    const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf-8');
    expect(schema).toMatch(/birthDate\s+DateTime\?/);
    const migration = readFileSync(
      join(__dirname, '../prisma/migrations/20261018000001_add_user_birth_date/migration.sql'),
      'utf-8',
    );
    expect(migration).toContain('ADD COLUMN "birth_date" TIMESTAMP(3)');
    expect(migration).not.toMatch(/birth_date".*NOT NULL/);
  });
});
