/**
 * UserService 单测（W7 P1-2 listUsers + W7-feature 2026-07-10 详情/动作）
 *
 * 覆盖：
 *   listUsers:
 *     - 默认分页（page=1, pageSize=20）
 *     - keyword 模糊匹配（name/phone/email）
 *     - role 筛选
 *     - status 筛选
 *     - orderCount + totalSpent 聚合（DELIVERED_PAID + COMPLETED）
 *     - 无订单用户 orderCount=0, totalSpent=0
 *     - 分页边界（page=2, hasMore=true）
 *
 *   getUserDetail:
 *     - 404 -> E-ADMIN-USER-001
 *     - 返回 recentOrders 最多 5 条 + addresses 全部
 *
 *   suspendUser:
 *     - self -> E-ADMIN-USER-005
 *     - target super_admin -> E-ADMIN-USER-004
 *     - 已 SUSPENDED/DELETED -> E-ADMIN-USER-003
 *
 *   activateUser:
 *     - 从 ACTIVE -> E-ADMIN-USER-003（无意义幂等）
 *     - 从 DELETED -> E-ADMIN-USER-003（终态）
 *
 *   resetUserPassword:
 *     - 返回 12 字符 + DB hash 调用 passwordStrategy.hashPassword
 *     - DELETED -> E-ADMIN-USER-003
 *
 *   updateUser:
 *     - demote self -> E-ADMIN-USER-005
 *     - P2002 unique 冲突 -> E-ADMIN-USER-002
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '../src/prisma/client';

const { mockDb, mockAuth, mockPasswordStrategy } = vi.hoisted(() => ({
  mockDb: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    order: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    address: {
      findMany: vi.fn(),
    },
  },
  mockAuth: {
    toContractRole: vi.fn((r: string) => r.toLowerCase()),
  },
  mockPasswordStrategy: {
    hashPassword: vi.fn(async (pw: string) => `hashed:${pw}`),
  },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));
vi.mock('../src/modules/auth/auth.service', () => ({
  AuthService: class {
    toContractRole = mockAuth.toContractRole;
  },
}));
vi.mock('../src/infrastructure/otp/password.strategy', () => ({
  passwordStrategy: mockPasswordStrategy,
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
            { phone: { contains: 'alice', mode: 'insensitive' } },
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

describe('UserService.getUserDetail', () => {
  let service: UserService;

  beforeEach(() => {
    mockDb.user.findUnique.mockReset();
    mockDb.order.findMany.mockReset();
    mockDb.address.findMany.mockReset();
    mockDb.order.aggregate.mockReset();
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

  const mockOrders = [
    {
      id: 'ord-1',
      orderNo: 'MM2026070101000001',
      status: 'DELIVERED_PAID',
      payableAmount: 3990,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    },
  ];

  const mockAddresses = [
    {
      id: 'addr-1',
      userId: 'u-1',
      name: 'Alice Home',
      phone: '+67088888888',
      region: { province: 'Dili', city: 'Dili', district: 'Vera Cruz' },
      detail: 'Rua dos Martires, No. 12',
      lat: null,
      lng: null,
      isDefault: true,
      tag: 'home',
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      deletedAt: null,
    },
  ];

  it('用户不存在抛 E-ADMIN-USER-001', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce(null);

    await expect(service.getUserDetail('nonexistent')).rejects.toMatchObject({
      response: { code: 'E-ADMIN-USER-001' },
    });
    expect(mockDb.user.findUnique).toHaveBeenCalledWith({ where: { id: 'nonexistent' } });
  });

  it('返回 recentOrders 最多 5 条 + addresses 全部 + 聚合', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce(mockUser);
    mockDb.order.findMany.mockResolvedValueOnce(mockOrders);
    mockDb.address.findMany.mockResolvedValueOnce(mockAddresses);
    mockDb.order.aggregate.mockResolvedValueOnce({
      _count: { _all: 3 },
      _sum: { payableAmount: 12000 },
    });

    const result = await service.getUserDetail('u-1');

    expect(result).toMatchObject({
      id: 'u-1',
      phone: '+67088888888',
      role: 'customer',
      status: 'ACTIVE',
      orderCount: 3,
      totalSpent: 12000,
    });
    expect(result.recentOrders).toHaveLength(1);
    expect(result.recentOrders[0]).toMatchObject({
      id: 'ord-1',
      orderNo: 'MM2026070101000001',
      status: 'DELIVERED_PAID',
      payableAmount: 3990,
    });
    expect(result.addresses).toHaveLength(1);
    expect(result.addresses[0]).toMatchObject({
      id: 'addr-1',
      name: 'Alice Home',
      isDefault: true,
    });
    // recentOrders take=5
    expect(mockDb.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5, orderBy: { createdAt: 'desc' } }),
    );
  });
});

describe('UserService.suspendUser', () => {
  let service: UserService;

  beforeEach(() => {
    mockDb.user.findUnique.mockReset();
    mockDb.user.update.mockReset();
    mockDb.order.findMany.mockReset();
    mockDb.address.findMany.mockReset();
    mockDb.order.aggregate.mockReset();
    mockAuth.toContractRole.mockReset();
    mockAuth.toContractRole.mockImplementation((r: string) => r.toLowerCase());
    service = new UserService(mockAuth as never);
  });

  it('self -> E-ADMIN-USER-005（不能暂停自己）', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({
      id: 'u-self',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    });

    await expect(service.suspendUser('u-self', 'u-self')).rejects.toMatchObject({
      response: { code: 'E-ADMIN-USER-005' },
    });
  });

  it('target.role=SUPER_ADMIN -> E-ADMIN-USER-004（不能暂停其他 super_admin）', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({
      id: 'u-other',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    });

    await expect(service.suspendUser('u-other', 'u-self')).rejects.toMatchObject({
      response: { code: 'E-ADMIN-USER-004' },
    });
  });

  it('已 SUSPENDED -> E-ADMIN-USER-003', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({
      id: 'u-other',
      role: 'CUSTOMER',
      status: 'SUSPENDED',
    });

    await expect(service.suspendUser('u-other', 'u-self')).rejects.toMatchObject({
      response: { code: 'E-ADMIN-USER-003' },
    });
  });

  it('DELETED 用户 -> E-ADMIN-USER-003', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({
      id: 'u-other',
      role: 'CUSTOMER',
      status: 'DELETED',
    });

    await expect(service.suspendUser('u-other', 'u-self')).rejects.toMatchObject({
      response: { code: 'E-ADMIN-USER-003' },
    });
  });

  it('用户不存在 -> E-ADMIN-USER-001', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce(null);

    await expect(service.suspendUser('nonexistent', 'u-self')).rejects.toMatchObject({
      response: { code: 'E-ADMIN-USER-001' },
    });
  });

  it('正常暂停：update status=SUSPENDED', async () => {
    // W7-fix（审查 #3/#4/#18）：service 重构后只 findUnique 1 次，update 返回完整 user 直接构建 DTO
    mockDb.user.findUnique.mockResolvedValueOnce({
      id: 'u-other',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      phone: '+67088888888',
      email: null,
      name: 'Bob',
      avatarUrl: null,
      phoneVerified: false,
      emailVerified: false,
      lastLoginAt: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    // update 返回 status=SUSPENDED 的完整 user（refactor 后直接用于构建 DTO，不再二次 findUnique）
    mockDb.user.update.mockResolvedValueOnce({
      id: 'u-other',
      role: 'CUSTOMER',
      status: 'SUSPENDED',
      phone: '+67088888888',
      email: null,
      name: 'Bob',
      avatarUrl: null,
      phoneVerified: false,
      emailVerified: false,
      lastLoginAt: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-10T00:00:00.000Z'),
    });
    mockDb.order.findMany.mockResolvedValueOnce([]);
    mockDb.address.findMany.mockResolvedValueOnce([]);
    mockDb.order.aggregate.mockResolvedValueOnce({
      _count: { _all: 0 },
      _sum: { payableAmount: 0 },
    });

    const result = await service.suspendUser('u-other', 'u-self');

    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-other' },
        data: { status: 'SUSPENDED' },
      }),
    );
    expect(result.status).toBe('SUSPENDED');
  });
});

describe('UserService.activateUser', () => {
  let service: UserService;

  beforeEach(() => {
    mockDb.user.findUnique.mockReset();
    mockDb.user.update.mockReset();
    mockDb.order.findMany.mockReset();
    mockDb.address.findMany.mockReset();
    mockDb.order.aggregate.mockReset();
    mockAuth.toContractRole.mockReset();
    mockAuth.toContractRole.mockImplementation((r: string) => r.toLowerCase());
    service = new UserService(mockAuth as never);
  });

  it('从 ACTIVE -> E-ADMIN-USER-003（无意义幂等）', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ status: 'ACTIVE' });

    await expect(service.activateUser('u-1')).rejects.toMatchObject({
      response: { code: 'E-ADMIN-USER-003' },
    });
  });

  it('从 DELETED -> E-ADMIN-USER-003（终态不可激活）', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ status: 'DELETED' });

    await expect(service.activateUser('u-1')).rejects.toMatchObject({
      response: { code: 'E-ADMIN-USER-003' },
    });
  });

  it('从 SUSPENDED -> ACTIVE 成功', async () => {
    // W7-fix（审查 #3/#4/#18）：service 重构后只 findUnique 1 次，update 返回完整 user 直接构建 DTO
    mockDb.user.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      role: 'CUSTOMER',
      status: 'SUSPENDED',
      phone: '+67088888888',
      email: null,
      name: 'Bob',
      avatarUrl: null,
      phoneVerified: false,
      emailVerified: false,
      lastLoginAt: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    // update 返回 status=ACTIVE 的完整 user（refactor 后直接用于构建 DTO，不再二次 findUnique）
    mockDb.user.update.mockResolvedValueOnce({
      id: 'u-1',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      phone: '+67088888888',
      email: null,
      name: 'Bob',
      avatarUrl: null,
      phoneVerified: false,
      emailVerified: false,
      lastLoginAt: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-10T00:00:00.000Z'),
    });
    mockDb.order.findMany.mockResolvedValueOnce([]);
    mockDb.address.findMany.mockResolvedValueOnce([]);
    mockDb.order.aggregate.mockResolvedValueOnce({
      _count: { _all: 0 },
      _sum: { payableAmount: 0 },
    });

    const result = await service.activateUser('u-1');

    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-1' },
        data: { status: 'ACTIVE' },
      }),
    );
    expect(result.status).toBe('ACTIVE');
  });
});

describe('UserService.resetUserPassword', () => {
  let service: UserService;

  beforeEach(() => {
    mockDb.user.findUnique.mockReset();
    mockDb.user.update.mockReset();
    mockPasswordStrategy.hashPassword.mockReset();
    mockPasswordStrategy.hashPassword.mockImplementation(async (pw: string) => `hashed:${pw}`);
    mockDb.order.findMany.mockReset();
    mockDb.address.findMany.mockReset();
    mockDb.order.aggregate.mockReset();
    mockAuth.toContractRole.mockReset();
    mockAuth.toContractRole.mockImplementation((r: string) => r.toLowerCase());
    service = new UserService(mockAuth as never);
  });

  it('DELETED 用户 -> E-ADMIN-USER-003', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ status: 'DELETED' });

    await expect(service.resetUserPassword('u-1')).rejects.toMatchObject({
      response: { code: 'E-ADMIN-USER-003' },
    });
  });

  it('用户不存在 -> E-ADMIN-USER-001', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce(null);

    await expect(service.resetUserPassword('u-1')).rejects.toMatchObject({
      response: { code: 'E-ADMIN-USER-001' },
    });
  });

  it('返回 12 字符临时密码 + DB hash 与原 password 不同 + 更新 passwordChangedAt', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      status: 'ACTIVE',
      password: 'old-hash',
    });
    mockDb.user.update.mockResolvedValueOnce({});

    const result = await service.resetUserPassword('u-1');

    expect(result.temporaryPassword).toHaveLength(12);
    expect(result.generatedAt).toBeTruthy();
    // base64url 字符集：字母 + 数字 + - 和 _
    expect(result.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(mockPasswordStrategy.hashPassword).toHaveBeenCalledWith(result.temporaryPassword);
    // W7-fix P0：update 应同时设 password + passwordChangedAt
    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-1' },
        data: expect.objectContaining({
          password: `hashed:${result.temporaryPassword}`,
          passwordChangedAt: expect.any(Date),
        }),
      }),
    );
    // hash 不等于明文
    const updateCall = mockDb.user.update.mock.calls[0][0];
    expect(updateCall.data.password).not.toBe(result.temporaryPassword);
  });
});

describe('UserService.updateUser', () => {
  let service: UserService;

  beforeEach(() => {
    mockDb.user.findUnique.mockReset();
    mockDb.user.update.mockReset();
    mockDb.order.findMany.mockReset();
    mockDb.address.findMany.mockReset();
    mockDb.order.aggregate.mockReset();
    mockAuth.toContractRole.mockReset();
    mockAuth.toContractRole.mockImplementation((r: string) => r.toLowerCase());
    service = new UserService(mockAuth as never);
  });

  it('demote self -> E-ADMIN-USER-005', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'u-self', role: 'SUPER_ADMIN' });

    await expect(
      service.updateUser('u-self', { role: 'CUSTOMER' }, 'u-self'),
    ).rejects.toMatchObject({
      response: { code: 'E-ADMIN-USER-005' },
    });
  });

  it('P2002 unique 冲突 -> E-ADMIN-USER-002', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'u-1', role: 'CUSTOMER' });
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: '5.0.0' },
    );
    mockDb.user.update.mockRejectedValueOnce(prismaError);

    await expect(
      service.updateUser('u-1', { phone: '+67077777777' }, 'u-self'),
    ).rejects.toMatchObject({
      response: { code: 'E-ADMIN-USER-002' },
    });
  });

  it('用户不存在 -> E-ADMIN-USER-001', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.updateUser('u-1', { name: 'Alice' }, 'u-self'),
    ).rejects.toMatchObject({
      response: { code: 'E-ADMIN-USER-001' },
    });
  });

  it('正常更新 name 字段', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      phone: '+67088888888',
      email: null,
      name: 'OldName',
      avatarUrl: null,
      phoneVerified: false,
      emailVerified: false,
      lastLoginAt: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    // W7-fix（审查 #3/#4/#18）：update 返回完整 user（NewName），refactor 后直接用于构建 DTO，不再二次 findUnique
    mockDb.user.update.mockResolvedValueOnce({
      id: 'u-1',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      phone: '+67088888888',
      email: null,
      name: 'NewName',
      avatarUrl: null,
      phoneVerified: false,
      emailVerified: false,
      lastLoginAt: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-10T00:00:00.000Z'),
    });
    mockDb.order.findMany.mockResolvedValueOnce([]);
    mockDb.address.findMany.mockResolvedValueOnce([]);
    mockDb.order.aggregate.mockResolvedValueOnce({
      _count: { _all: 0 },
      _sum: { payableAmount: 0 },
    });

    const result = await service.updateUser('u-1', { name: 'NewName' }, 'u-self');

    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-1' },
        data: { name: 'NewName' },
      }),
    );
    expect(result.name).toBe('NewName');
  });

  it('super_admin 改自己的非 role 字段不抛错', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({
      id: 'u-self',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      phone: '+67088888888',
      email: null,
      name: 'Admin',
      avatarUrl: null,
      phoneVerified: true,
      emailVerified: true,
      lastLoginAt: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    // W7-fix（审查 #3/#4/#18）：update 返回完整 user，refactor 后不再二次 findUnique
    mockDb.user.update.mockResolvedValueOnce({
      id: 'u-self',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      phone: '+67088888888',
      email: null,
      name: 'Admin Updated',
      avatarUrl: null,
      phoneVerified: true,
      emailVerified: true,
      lastLoginAt: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-10T00:00:00.000Z'),
    });
    mockDb.order.findMany.mockResolvedValueOnce([]);
    mockDb.address.findMany.mockResolvedValueOnce([]);
    mockDb.order.aggregate.mockResolvedValueOnce({
      _count: { _all: 0 },
      _sum: { payableAmount: 0 },
    });

    const result = await service.updateUser('u-self', { name: 'Admin Updated' }, 'u-self');

    expect(result.name).toBe('Admin Updated');
  });
});
