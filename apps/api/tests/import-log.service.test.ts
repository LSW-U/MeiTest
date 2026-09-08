/**
 * ImportLog Service + ListImportLogsQuery 测试（批E 审查 P2-1 ③④，2026-09-07）
 *
 * 覆盖：
 *   ③ list 查询的 resourceType/操作人/时间过滤与 page/pageSize 分页（where/skip/take/count 断言）
 *   ④ ListImportLogsQuery zod safeParse（pageSize>100 拒绝 / 字符串页码 coerce / resourceType 枚举）
 *
 * 实现约束（Why）：
 * - controller 单测 mock 不经过 ZodValidationPipe（meimart-controller-zod-test-blindspot），
 *   zod 拒绝路径直接 safeParse contract schema，不过 controller；
 * - prisma mock 盲区（meimart-prisma-mock-blindspot）：orderBy 字段以 schema 为准，
 *   ImportLog 有 createdAt（schema.prisma），断言里显式锁定 orderBy 防漂移。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  importLogFindMany: vi.fn(),
  importLogCount: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({
  db: {
    importLog: {
      findMany: m.importLogFindMany,
      count: m.importLogCount,
    },
  },
}));

import { ImportLogService } from '../src/modules/import-log/import-log.service';
import { ListImportLogsQuery } from '@meimart/api-contract';

describe('ImportLogService.list（批E P2-1 ③）', () => {
  let service: ImportLogService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new ImportLogService();
  });

  it('resourceType + 操作人 + 时间范围 → where 组装正确，createdAt 倒序 + 分页', async () => {
    const item = {
      id: 'log-1',
      fileName: 'stock.csv',
      resourceType: 'Stock',
      successCount: 3,
      failedCount: 1,
      failedRows: [{ row: 2, error: 'deltaQty cannot be 0' }],
      operatorId: 'admin-1',
      mode: null,
      createdAt: new Date('2026-09-07T08:00:00Z'),
    };
    m.importLogFindMany.mockResolvedValue([item]);
    m.importLogCount.mockResolvedValue(11);

    const result = await service.list({
      resourceType: 'Stock',
      operatorId: 'admin-1',
      from: '2026-09-01T00:00:00Z',
      to: '2026-09-08T00:00:00Z',
      page: 2,
      pageSize: 10,
    });

    // where：resourceType + operatorId + 时间范围（from 含 / to 不含）
    expect(m.importLogFindMany).toHaveBeenCalledWith({
      where: {
        resourceType: 'Stock',
        operatorId: 'admin-1',
        createdAt: {
          gte: new Date('2026-09-01T00:00:00Z'),
          lt: new Date('2026-09-08T00:00:00Z'),
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: 10, // (page-1)*pageSize
      take: 10,
    });
    expect(m.importLogCount).toHaveBeenCalledWith({
      where: {
        resourceType: 'Stock',
        operatorId: 'admin-1',
        createdAt: {
          gte: new Date('2026-09-01T00:00:00Z'),
          lt: new Date('2026-09-08T00:00:00Z'),
        },
      },
    });
    // 分页元数据 + Json 字段还原 + Date → ISO 字符串
    expect(result).toEqual({
      items: [
        {
          ...item,
          createdAt: '2026-09-07T08:00:00.000Z',
          failedRows: [{ row: 2, error: 'deltaQty cannot be 0' }],
        },
      ],
      page: 2,
      pageSize: 10,
      total: 11,
    });
  });

  it('无过滤 → where 为空对象，默认 page=1/pageSize=20', async () => {
    m.importLogFindMany.mockResolvedValue([]);
    m.importLogCount.mockResolvedValue(0);

    const result = await service.list({});

    expect(m.importLogFindMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.total).toBe(0);
  });
});

describe('ListImportLogsQuery zod（批E P2-1 ④：controller 不过 Zod pipe，直接 safeParse）', () => {
  it('合法输入：字符串页码 coerce + resourceType 枚举过', () => {
    const parsed = ListImportLogsQuery.safeParse({
      resourceType: 'Stock',
      page: '2',
      pageSize: '10',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ resourceType: 'Stock', page: 2, pageSize: 10 });
    }
  });

  it('pageSize>100 → 拒绝（防拉爆）', () => {
    const parsed = ListImportLogsQuery.safeParse({ pageSize: 101 });
    expect(parsed.success).toBe(false);
  });

  it('resourceType 非 Product|Stock → 拒绝；非 uuid operatorId → 拒绝；非法时间 → 拒绝', () => {
    expect(ListImportLogsQuery.safeParse({ resourceType: 'Foo' }).success).toBe(false);
    expect(ListImportLogsQuery.safeParse({ operatorId: 'not-uuid' }).success).toBe(false);
    expect(ListImportLogsQuery.safeParse({ from: '2026-09-01' }).success).toBe(false); // 非 ISO datetime
  });
});
