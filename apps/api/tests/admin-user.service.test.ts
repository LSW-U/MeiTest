/**
 * UserService.listUsers 单测（W7 P1-2）
 *
 * 覆盖：
 *   - 默认分页（page=1, pageSize=20）
 *   - keyword 模糊匹配（name/phone/email）
 *   - role 筛选
 *   - status 筛选
 *   - orderCount + totalSpent 聚合（DELIVERED_PAID + COMPLETED）
 *   - 无订单用户 orderCount=0, totalSpent=0
 *   - 分页边界（page=2, hasMore=true）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb, mockAuth } = vi.hoisted(() => ({
  mockDb: {
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    order: {
      groupBy: vi.fn(),
    },
  },
  mockAuth: {
    toContractRole: vi.fn((r: string) => r.toLowerCase()),
  },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));
vi.mock('../src/modules/auth/auth.service', () => ({
  AuthService: class {
    toContractRole = mockAuth.toContractRole;
  },
}));

import { UserService } from '../src/modules/user/user.service';

describe('UserService.listUsers', () => {
  let service: UserService;

  beforeEach(() => {
    mockDb.user.findMany.mockReset();
    mockDb.user.count.mockReset();
    mockDb.order.groupBy.mockReset();
    mockAuth.toContractRole.mockReset();
    mockAuth.toContractRole.mockImplementation((r: string) => r.toLowerCase());

    service = new UserService(mockAuth as never);
  });

  const mockUser = {
    id: 'u-1',
    phone: '+67088888888',
    email: 'alice@example.com',
    name: 'Alice',
    avatarUrl: null,
    role: 'CUSTOMER',
    status: 'ACTIVE',
    phoneVerified: true,
    emailVerified: true,
    lastLoginAt: new Date('2026-07-01T00:00:00.000Z'),
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  };

  it('默认分页：page=1, pageSize=20', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([mockUser]);
    mockDb.user.count.mockResolvedValueOnce(1);
    mockDb.order.groupBy.mockResolvedValueOnce([
      { userId: 'u-1', _count: { _all: 3 }, _sum: { payableAmount: 5000 } },
    ]);

    const result = await service.listUsers();

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.total).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(mockDb.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('keyword 模糊匹配（name/phone/email OR）', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([]);
    mockDb.user.count.mockResolvedValueOnce(0);

    await service.listUsers({ keyword: 'alice' });

    expect(mockDb.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { phone: { contains: 'alice' } },
            { email: { contains: 'alice', mode: 'insensitive' } },
            { name: { contains: 'alice', mode: 'insensitive' } },
          ]),
        }),
      }),
    );
  });

  it('role 筛选（CUSTOMER）', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([]);
    mockDb.user.count.mockResolvedValueOnce(0);

    await service.listUsers({ role: 'CUSTOMER' });

    expect(mockDb.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: 'CUSTOMER' }),
      }),
    );
  });

  it('status 筛选（ACTIVE）', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([]);
    mockDb.user.count.mockResolvedValueOnce(0);

    await service.listUsers({ status: 'ACTIVE' });

    expect(mockDb.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
  });

  it('orderCount + totalSpent 聚合正确', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([mockUser]);
    mockDb.user.count.mockResolvedValueOnce(1);
    mockDb.order.groupBy.mockResolvedValueOnce([
      { userId: 'u-1', _count: { _all: 5 }, _sum: { payableAmount: 12345 } },
    ]);

    const result = await service.listUsers();

    expect(result.items[0].orderCount).toBe(5);
    expect(result.items[0].totalSpent).toBe(12345);
  });

  it('无订单用户 orderCount=0, totalSpent=0', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([mockUser]);
    mockDb.user.count.mockResolvedValueOnce(1);
    mockDb.order.groupBy.mockResolvedValueOnce([]);

    const result = await service.listUsers();

    expect(result.items[0].orderCount).toBe(0);
    expect(result.items[0].totalSpent).toBe(0);
  });

  it('分页边界：page=2, pageSize=10, hasMore=true', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([mockUser]);
    mockDb.user.count.mockResolvedValueOnce(15);
    mockDb.order.groupBy.mockResolvedValueOnce([]);

    const result = await service.listUsers({ page: 2, pageSize: 10 });

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
    expect(result.hasMore).toBe(true); // skip=10, items=1, total=15
    expect(mockDb.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
      }),
    );
  });

  it('返回字段含 phone/email/name/role/status/orderCount/totalSpent', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([mockUser]);
    mockDb.user.count.mockResolvedValueOnce(1);
    mockDb.order.groupBy.mockResolvedValueOnce([]);

    const result = await service.listUsers();
    const item = result.items[0];

    expect(item).toMatchObject({
      id: 'u-1',
      phone: '+67088888888',
      email: 'alice@example.com',
      name: 'Alice',
      role: 'customer', // contract 小写
      status: 'ACTIVE',
      phoneVerified: true,
      emailVerified: true,
      orderCount: 0,
      totalSpent: 0,
    });
    expect(item.lastLoginAt).toBe('2026-07-01T00:00:00.000Z');
    expect(item.createdAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('pageSize 上限 100', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([]);
    mockDb.user.count.mockResolvedValueOnce(0);

    const result = await service.listUsers({ pageSize: 500 });

    expect(result.pageSize).toBe(100);
  });

  it('page 最小 1', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([]);
    mockDb.user.count.mockResolvedValueOnce(0);

    const result = await service.listUsers({ page: -5 });

    expect(result.page).toBe(1);
  });

  it('聚合查询的 status 包含 DELIVERED_PAID + COMPLETED', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([mockUser]);
    mockDb.user.count.mockResolvedValueOnce(1);
    mockDb.order.groupBy.mockResolvedValueOnce([]);

    await service.listUsers();

    expect(mockDb.order.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['DELIVERED_PAID', 'COMPLETED'] },
        }),
      }),
    );
  });
});
