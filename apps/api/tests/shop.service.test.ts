/**
 * Shop Service 测试（W 流程 2026-06-24）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

const { shopFindFirst, shopUpdate } = vi.hoisted(() => ({
  shopFindFirst: vi.fn(),
  shopUpdate: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({
  db: {
    shop: {
      findFirst: shopFindFirst,
      update: shopUpdate,
    },
  },
}));

import { ShopService } from '../src/modules/shop/shop.service';

describe('ShopService', () => {
  let service: ShopService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new ShopService();
  });

  const mockShopRow = {
    id: 'shop-1',
    name: { en: 'MeiMart', zh: '美超市' },
    announcement: { en: 'Welcome' },
    logoUrl: 'https://example.com/logo.png',
    phone: '+670999999999',
    address: 'Dili',
    lat: { toNumber: () => -8.5568 },
    lng: { toNumber: () => 125.56 },
    status: 'ACTIVE',
    businessHours: { mon: { open: '08:00', close: '22:00' } },
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  };

  describe('getShop', () => {
    it('返回店铺 DTO（lat/lng 转 number）', async () => {
      shopFindFirst.mockResolvedValueOnce(mockShopRow);
      const shop = await service.getShop();
      expect(shop.id).toBe('shop-1');
      expect(shop.name.en).toBe('MeiMart');
      expect(shop.lat).toBe(-8.5568);
      expect(shop.lng).toBe(125.56);
    });

    it('未初始化抛 NotFoundException', async () => {
      shopFindFirst.mockResolvedValueOnce(null);
      await expect(service.getShop()).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateShop', () => {
    it('更新部分字段', async () => {
      shopFindFirst.mockResolvedValueOnce(mockShopRow);
      shopUpdate.mockResolvedValueOnce({ ...mockShopRow, phone: '+670111111111' });

      const result = await service.updateShop({ phone: '+670111111111' });
      expect(result.phone).toBe('+670111111111');
      expect(shopUpdate).toHaveBeenCalledWith({
        where: { id: 'shop-1' },
        data: { phone: '+670111111111' },
      });
    });

    it('未初始化抛 NotFoundException', async () => {
      shopFindFirst.mockResolvedValueOnce(null);
      await expect(service.updateShop({ phone: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('更新多语言 name（整体替换 JSON）', async () => {
      shopFindFirst.mockResolvedValueOnce(mockShopRow);
      shopUpdate.mockResolvedValueOnce({
        ...mockShopRow,
        name: { en: 'NewMart', zh: '新超市' },
      });
      const newName = { en: 'NewMart', zh: '新超市' };
      const result = await service.updateShop({ name: newName });
      expect(result.name.en).toBe('NewMart');
      expect(shopUpdate).toHaveBeenCalledWith({
        where: { id: 'shop-1' },
        data: { name: newName },
      });
    });
  });
});
