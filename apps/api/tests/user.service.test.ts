/**
 * User Service 测试（W 流程 2026-06-24）
 *
 * 覆盖 profile / address / favorite / notification 关键场景
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

// Mock db
const dbMocks = {
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  addressFindMany: vi.fn(),
  addressFindFirst: vi.fn(),
  addressCreate: vi.fn(),
  addressUpdate: vi.fn(),
  addressUpdateMany: vi.fn(),
  addressDelete: vi.fn(),
  favoriteFindUnique: vi.fn(),
  favoriteFindMany: vi.fn(),
  favoriteCreate: vi.fn(),
  favoriteDelete: vi.fn(),
  notificationFindFirst: vi.fn(),
  notificationFindMany: vi.fn(),
  notificationUpdate: vi.fn(),
  notificationUpdateMany: vi.fn(),
  notificationCount: vi.fn(),
  $transaction: vi.fn(),
};
const { dbMocks: hoistedMocks } = vi.hoisted(() => ({
  dbMocks: {
    userFindUnique: vi.fn(),
    userUpdate: vi.fn(),
    addressFindMany: vi.fn(),
    addressFindFirst: vi.fn(),
    addressCreate: vi.fn(),
    addressUpdate: vi.fn(),
    addressUpdateMany: vi.fn(),
    addressDelete: vi.fn(),
    favoriteFindUnique: vi.fn(),
    favoriteFindMany: vi.fn(),
    favoriteCreate: vi.fn(),
    favoriteDelete: vi.fn(),
    notificationFindFirst: vi.fn(),
    notificationFindMany: vi.fn(),
    notificationUpdate: vi.fn(),
    notificationUpdateMany: vi.fn(),
    notificationCount: vi.fn(),
    $transaction: vi.fn(),
  },
}));
// 把 hoisted fn 同步到外层引用（便于 beforeEach 重置）
Object.assign(dbMocks, hoistedMocks);

vi.mock('../src/shared/db', () => ({
  db: {
    user: {
      findUnique: hoistedMocks.userFindUnique,
      update: hoistedMocks.userUpdate,
    },
    address: {
      findMany: hoistedMocks.addressFindMany,
      findFirst: hoistedMocks.addressFindFirst,
      create: hoistedMocks.addressCreate,
      update: hoistedMocks.addressUpdate,
      updateMany: hoistedMocks.addressUpdateMany,
      delete: hoistedMocks.addressDelete,
    },
    favorite: {
      findUnique: hoistedMocks.favoriteFindUnique,
      findMany: hoistedMocks.favoriteFindMany,
      create: hoistedMocks.favoriteCreate,
      delete: hoistedMocks.favoriteDelete,
    },
    notification: {
      findFirst: hoistedMocks.notificationFindFirst,
      findMany: hoistedMocks.notificationFindMany,
      update: hoistedMocks.notificationUpdate,
      updateMany: hoistedMocks.notificationUpdateMany,
      count: hoistedMocks.notificationCount,
    },
    $transaction: hoistedMocks.$transaction,
  },
}));

// Mock AuthService（只需要 toContractRole）
vi.mock('../src/modules/auth/auth.service', () => ({
  AuthService: class {
    toContractRole(prismaRole: string) {
      return prismaRole.toLowerCase();
    }
  },
}));

import { UserService } from '../src/modules/user/user.service';

describe('UserService', () => {
  let service: UserService;
  // @ts-expect-error mock AuthService
  const mockAuth = { toContractRole: (r: string) => r.toLowerCase() } as never;

  beforeEach(() => {
    vi.resetAllMocks();
    // @ts-expect-error 用 mock AuthService 实例化
    service = new UserService(mockAuth);
  });

  describe('getProfile', () => {
    it('返回 user profile（role 转 contract 小写）', async () => {
      dbMocks.userFindUnique.mockResolvedValueOnce({
        id: 'user-1',
        phone: '+670999999999',
        email: null,
        name: 'Alice',
        avatarUrl: null,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        phoneVerified: true,
        emailVerified: false,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      });

      const profile = await service.getProfile('user-1');
      expect(profile.id).toBe('user-1');
      expect(profile.role).toBe('customer');
      expect(profile.name).toBe('Alice');
    });

    it('找不到用户抛 NotFoundException', async () => {
      dbMocks.userFindUnique.mockResolvedValueOnce(null);
      await expect(service.getProfile('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('更新 name 字段', async () => {
      dbMocks.userUpdate.mockResolvedValueOnce({
        id: 'user-1',
        phone: '+670999999999',
        email: null,
        name: 'NewName',
        avatarUrl: null,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-03'),
      });

      const updated = await service.updateProfile('user-1', { name: 'NewName' });
      expect(updated.name).toBe('NewName');
      expect(dbMocks.userUpdate).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { name: 'NewName' },
      });
    });
  });

  describe('listAddresses', () => {
    it('返回排序后的地址列表（默认在前）', async () => {
      dbMocks.addressFindMany.mockResolvedValueOnce([
        {
          id: 'addr-1',
          userId: 'user-1',
          name: 'Home',
          phone: '+670999999999',
          region: { province: 'Dili', city: 'Dili' },
          detail: 'Rua A',
          lat: null,
          lng: null,
          isDefault: true,
          tag: null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ]);

      const list = await service.listAddresses('user-1');
      expect(list).toHaveLength(1);
      expect(list[0].isDefault).toBe(true);
      expect(list[0].region.province).toBe('Dili');
    });
  });

  describe('createAddress', () => {
    it('普通地址创建', async () => {
      dbMocks.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          address: {
            create: hoistedMocks.addressCreate,
            updateMany: hoistedMocks.addressUpdateMany,
          },
        }),
      );
      dbMocks.addressCreate.mockResolvedValueOnce({
        id: 'addr-new',
        userId: 'user-1',
        name: 'Office',
        phone: '+670999999999',
        region: { province: 'Dili', city: 'Dili' },
        detail: 'Rua B',
        lat: null,
        lng: null,
        isDefault: false,
        tag: 'work',
        createdAt: new Date('2026-01-02'),
        updatedAt: new Date('2026-01-02'),
      });

      const result = await service.createAddress('user-1', {
        name: 'Office',
        phone: '+670999999999',
        region: { province: 'Dili', city: 'Dili' },
        detail: 'Rua B',
        tag: 'work',
      });
      expect(result.id).toBe('addr-new');
      expect(dbMocks.addressUpdateMany).not.toHaveBeenCalled();
    });

    it('设默认地址时先取消旧默认', async () => {
      dbMocks.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          address: {
            create: hoistedMocks.addressCreate,
            updateMany: hoistedMocks.addressUpdateMany,
          },
        }),
      );
      dbMocks.addressUpdateMany.mockResolvedValueOnce({ count: 1 });
      dbMocks.addressCreate.mockResolvedValueOnce({
        id: 'addr-2',
        userId: 'user-1',
        name: 'Home',
        phone: '+670999999999',
        region: { province: 'Dili', city: 'Dili' },
        detail: 'Rua C',
        lat: null,
        lng: null,
        isDefault: true,
        tag: null,
        createdAt: new Date('2026-01-03'),
        updatedAt: new Date('2026-01-03'),
      });

      const result = await service.createAddress('user-1', {
        name: 'Home',
        phone: '+670999999999',
        region: { province: 'Dili', city: 'Dili' },
        detail: 'Rua C',
        isDefault: true,
      });
      expect(result.isDefault).toBe(true);
      expect(dbMocks.addressUpdateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isDefault: true },
        data: { isDefault: false },
      });
    });
  });

  describe('deleteAddress', () => {
    it('删除存在的地址', async () => {
      dbMocks.addressFindFirst.mockResolvedValueOnce({ id: 'addr-1' });
      dbMocks.addressDelete.mockResolvedValueOnce({});
      await service.deleteAddress('user-1', 'addr-1');
      expect(dbMocks.addressDelete).toHaveBeenCalledWith({ where: { id: 'addr-1' } });
    });

    it('找不到地址抛 NotFoundException', async () => {
      dbMocks.addressFindFirst.mockResolvedValueOnce(null);
      await expect(service.deleteAddress('user-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('toggleFavorite', () => {
    it('未收藏 → 新增', async () => {
      dbMocks.favoriteFindUnique.mockResolvedValueOnce(null);
      dbMocks.favoriteCreate.mockResolvedValueOnce({});
      const result = await service.toggleFavorite('user-1', 'prod-1');
      expect(result.isFavorite).toBe(true);
      expect(dbMocks.favoriteCreate).toHaveBeenCalled();
    });

    it('已收藏 → 取消', async () => {
      dbMocks.favoriteFindUnique.mockResolvedValueOnce({ id: 'fav-1' });
      dbMocks.favoriteDelete.mockResolvedValueOnce({});
      const result = await service.toggleFavorite('user-1', 'prod-1');
      expect(result.isFavorite).toBe(false);
      expect(dbMocks.favoriteDelete).toHaveBeenCalledWith({ where: { id: 'fav-1' } });
    });
  });

  describe('notifications', () => {
    it('listNotifications 返回最新 100 条', async () => {
      dbMocks.notificationFindMany.mockResolvedValueOnce([
        {
          id: 'n-1',
          userId: 'user-1',
          type: 'ORDER_UPDATE',
          title: { en: 'Order update' },
          content: { en: 'Your order is confirmed' },
          isRead: false,
          data: { orderId: 'o-1' },
          createdAt: new Date('2026-01-01'),
        },
      ]);
      const list = await service.listNotifications('user-1');
      expect(list).toHaveLength(1);
      expect(list[0].type).toBe('ORDER_UPDATE');
      expect(list[0].data?.orderId).toBe('o-1');
    });

    it('markNotificationRead 找不到抛 NotFoundException', async () => {
      dbMocks.notificationFindFirst.mockResolvedValueOnce(null);
      await expect(service.markNotificationRead('user-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('markAllRead 触发 updateMany', async () => {
      dbMocks.notificationUpdateMany.mockResolvedValueOnce({ count: 5 });
      const result = await service.markAllNotificationsRead('user-1');
      expect(result.success).toBe(true);
      expect(dbMocks.notificationUpdateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isRead: false },
        data: { isRead: true },
      });
    });

    it('getUnreadCount 返回数量', async () => {
      dbMocks.notificationCount.mockResolvedValueOnce(7);
      const result = await service.getUnreadCount('user-1');
      expect(result.count).toBe(7);
    });
  });
});
