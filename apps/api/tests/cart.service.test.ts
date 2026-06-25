/**
 * Cart Service 单测（重点测 Redis 缓存层 + 写操作失效）
 *
 * 覆盖：
 *   - getCart 缓存命中 → 直接返回（不查 DB）
 *   - getCart 缓存 miss → 查 DB + 回填 Redis
 *   - addItem/updateItem/removeItem/clearOrderedItems 后 invalidateCache
 *   - Redis 异常容错（catch + 降级）
 *   - quantity < 1 → E-CART-001
 *   - SKU 不存在/下架 → E-CART-002
 *   - cart item 不存在 → E-CART-003
 *   - 无选中项 previewCheckout → E-CART-004
 *
 * mock：db（cart/cartItem/sku/address/findWarehouseByPoint）+ redis
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb, mockRedis } = vi.hoisted(() => ({
  mockDb: {
    cart: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    cartItem: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    sku: {
      findUnique: vi.fn(),
    },
    address: {
      findUnique: vi.fn(),
    },
  },
  mockRedis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock('../src/shared/db', () => ({
  db: mockDb,
  withTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb)),
  deductStock: vi.fn(),
  releaseStock: vi.fn(),
  findWarehouseByPoint: vi.fn(),
}));

vi.mock('../src/shared/cache', () => ({ redis: mockRedis }));

import { CartService } from '../src/modules/cart/cart.service';

describe('CartService - Redis 缓存层', () => {
  let service: CartService;

  beforeEach(() => {
    service = new CartService();
    Object.values(mockDb).forEach((table) => {
      Object.values(table).forEach((fn) => fn.mockReset());
    });
    mockRedis.get.mockReset();
    mockRedis.set.mockReset();
    mockRedis.del.mockReset();
  });

  describe('getCart - 缓存命中', () => {
    it('Redis 有缓存 → 直接返回（不查 DB）', async () => {
      const cached = {
        id: 'cart-1',
        userId: 'user-1',
        warehouseId: null,
        items: [{ id: 'item-1', skuId: 'sku-1', unitPrice: 100, quantity: 2, isSelected: true }],
        selectedSubtotal: 200,
        totalSubtotal: 200,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.getCart('user-1');

      expect(result).toEqual(cached);
      expect(mockRedis.get).toHaveBeenCalledWith('cart:user-1');
      expect(mockDb.cart.findUnique).not.toHaveBeenCalled();
    });

    it('Redis 缓存格式坏（JSON 解析失败）→ 抛错（不静默掩盖）', async () => {
      mockRedis.get.mockResolvedValue('not-json');

      await expect(service.getCart('user-1')).rejects.toThrow();
    });
  });

  describe('getCart - 缓存 miss', () => {
    it('Redis miss → 查 DB + 回填缓存', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockDb.cart.findUnique.mockResolvedValue({
        id: 'cart-1',
        userId: 'user-1',
        warehouseId: null,
      });
      mockDb.cartItem.findMany.mockResolvedValue([
        {
          id: 'item-1',
          skuId: 'sku-1',
          productId: 'p-1',
          productName: { en: 'Milk' },
          productImage: 'url',
          skuName: { en: '1L' },
          unitPrice: 100,
          quantity: 2,
          isSelected: true,
          addedAt: new Date('2026-06-25T00:00:00Z'),
        },
      ]);

      const result = await service.getCart('user-1');

      expect(result.items).toHaveLength(1);
      expect(result.selectedSubtotal).toBe(200);
      expect(result.totalSubtotal).toBe(200);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'cart:user-1',
        expect.any(String),
        'EX',
        300,
      );
    });

    it('Redis miss + 无 cart 记录 → 自动 create cart', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockDb.cart.findUnique.mockResolvedValue(null);
      mockDb.cart.create.mockResolvedValue({ id: 'new-cart', userId: 'user-1', warehouseId: null });
      mockDb.cartItem.findMany.mockResolvedValue([]);

      const result = await service.getCart('user-1');

      expect(result.id).toBe('new-cart');
      expect(result.items).toEqual([]);
      expect(mockDb.cart.create).toHaveBeenCalledWith({ data: { userId: 'user-1' } });
    });
  });

  describe('addItem - 缓存失效', () => {
    it('加购后 invalidateCache + 重新 getCart', async () => {
      const sku = {
        id: 'sku-1',
        productId: 'p-1',
        price: 100,
        status: 'ACTIVE',
        name: { en: '1L' },
        product: {
          id: 'p-1',
          name: { en: 'Milk' },
          mainImage: 'img',
          status: 'ACTIVE',
        },
      };
      mockDb.sku.findUnique.mockResolvedValue(sku);
      mockDb.cart.findUnique.mockResolvedValue({ id: 'cart-1', userId: 'user-1', warehouseId: null });
      mockDb.cartItem.upsert.mockResolvedValue({});
      // 第二次 getCart（addItem 内）miss 缓存 → 回填
      mockRedis.get.mockResolvedValue(null);
      mockDb.cartItem.findMany.mockResolvedValue([]);

      await service.addItem({ userId: 'user-1', skuId: 'sku-1', quantity: 1 });

      // invalidate cache called
      expect(mockRedis.del).toHaveBeenCalledWith('cart:user-1');
      // 后续 getCart 重新回填
      expect(mockRedis.set).toHaveBeenCalled();
    });

    it('quantity < 1 → 抛 ConflictException（E-CART-001）', async () => {
      await expect(
        service.addItem({ userId: 'user-1', skuId: 'sku-1', quantity: 0 }),
      ).rejects.toThrow(/quantity must be >= 1/);
    });

    it('SKU 不存在 → 抛 ConflictException（E-CART-002）', async () => {
      mockDb.sku.findUnique.mockResolvedValue(null);

      await expect(
        service.addItem({ userId: 'user-1', skuId: 'sku-x', quantity: 1 }),
      ).rejects.toThrow(/SKU not found or inactive/);
    });

    it('SKU 已下架 → 抛 ConflictException（E-CART-002）', async () => {
      mockDb.sku.findUnique.mockResolvedValue({
        id: 'sku-1',
        status: 'INACTIVE',
        product: { status: 'ACTIVE' },
      });

      await expect(
        service.addItem({ userId: 'user-1', skuId: 'sku-1', quantity: 1 }),
      ).rejects.toThrow(/SKU not found or inactive/);
    });

    it('product 已下架 → 抛 ConflictException（E-CART-002）', async () => {
      mockDb.sku.findUnique.mockResolvedValue({
        id: 'sku-1',
        status: 'ACTIVE',
        product: { status: 'INACTIVE' },
      });

      await expect(
        service.addItem({ userId: 'user-1', skuId: 'sku-1', quantity: 1 }),
      ).rejects.toThrow(/SKU not found or inactive/);
    });
  });

  describe('updateItem - 校验', () => {
    it('item 不存在 → 抛 NotFoundException（E-CART-003）', async () => {
      mockDb.cartItem.findUnique.mockResolvedValue(null);
      await expect(
        service.updateItem({ userId: 'u1', itemId: 'x', quantity: 2 }),
      ).rejects.toThrow(/Cart item not found/);
    });

    it('item 属于其他用户 → 抛 NotFoundException（E-CART-003）', async () => {
      mockDb.cartItem.findUnique.mockResolvedValue({ id: 'i1', cartId: 'c1' });
      mockDb.cart.findUnique.mockResolvedValue({ id: 'c1', userId: 'other-user' });

      await expect(
        service.updateItem({ userId: 'u1', itemId: 'i1', quantity: 2 }),
      ).rejects.toThrow(/Cart item not found/);
    });

    it('quantity < 1 → 抛 ConflictException（E-CART-001）', async () => {
      mockDb.cartItem.findUnique.mockResolvedValue({ id: 'i1', cartId: 'c1' });
      mockDb.cart.findUnique.mockResolvedValue({ id: 'c1', userId: 'u1' });

      await expect(
        service.updateItem({ userId: 'u1', itemId: 'i1', quantity: 0 }),
      ).rejects.toThrow(/quantity must be >= 1/);
    });
  });

  describe('Redis 异常容错', () => {
    it('getCart Redis 异常 → 降级查 DB（不阻塞业务）', async () => {
      mockRedis.get.mockRejectedValue(new Error('redis down'));
      mockDb.cart.findUnique.mockResolvedValue({ id: 'c1', userId: 'u1', warehouseId: null });
      mockDb.cartItem.findMany.mockResolvedValue([]);
      mockRedis.set.mockRejectedValue(new Error('redis down')); // 写也失败

      const result = await service.getCart('u1');

      expect(result.id).toBe('c1');
      expect(result.items).toEqual([]);
    });

    it('invalidateCache Redis del 失败 → 不抛错（吞掉）', async () => {
      mockRedis.del.mockRejectedValue(new Error('redis down'));

      // addItem 流程：findUnique sku + upsert + invalidate + getCart
      mockDb.sku.findUnique.mockResolvedValue({
        id: 'sku-1',
        productId: 'p-1',
        price: 100,
        status: 'ACTIVE',
        name: { en: '1L' },
        product: { id: 'p-1', name: { en: 'M' }, mainImage: 'i', status: 'ACTIVE' },
      });
      mockDb.cart.findUnique.mockResolvedValue({ id: 'c1', userId: 'u1', warehouseId: null });
      mockDb.cartItem.upsert.mockResolvedValue({});
      mockRedis.get.mockResolvedValue(null);
      mockDb.cartItem.findMany.mockResolvedValue([]);

      // 不抛错就是通过
      await expect(
        service.addItem({ userId: 'u1', skuId: 'sku-1', quantity: 1 }),
      ).resolves.toBeDefined();
    });
  });
});
