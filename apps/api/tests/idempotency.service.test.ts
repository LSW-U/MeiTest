/**
 * IdempotencyService 单测
 *
 * 覆盖：
 *   - key 未传 → 直接执行 fn（向后兼容）
 *   - 首次 key → INSERT PENDING → 执行 fn → UPDATE SUCCESS
 *   - 同 key 重试（SUCCESS）→ 返回缓存的 responsePayload（不再执行 fn）
 *   - 并发同 key（PENDING）→ 抛 IdempotencyConcurrentException
 *   - FAILED 状态 → 抛 IdempotencyConcurrentException
 *   - fn 抛错 → UPDATE FAILED + 原错误透传
 *   - 过期记录 → 删旧 + 重建 + 执行
 *
 * mock：db.idempotencyKey（create/findUnique/update/delete）+ Prisma.PrismaClientKnownRequestError
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb, MockPrismaClientKnownRequestError } = vi.hoisted(() => {
  class MockPrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, { code }: { code: string }) {
      super(message);
      this.name = 'PrismaClientKnownRequestError';
      this.code = code;
    }
  }
  return {
    mockDb: {
      idempotencyKey: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    },
    MockPrismaClientKnownRequestError,
  };
});

vi.mock('../src/shared/db', () => ({ db: mockDb }));

vi.mock('../src/prisma/client', () => ({
  Prisma: {
    PrismaClientKnownRequestError: MockPrismaClientKnownRequestError,
    InputJsonValue: Symbol('InputJsonValue'),
    JsonNull: Symbol('JsonNull'),
  },
}));

import { IdempotencyService, IdempotencyConcurrentException } from '../src/shared/idempotency/idempotency.service';

/** 构造 Prisma 唯一约束冲突错误 */
function uniqueViolation(): Error {
  return new MockPrismaClientKnownRequestError('UNIQUE', { code: 'P2002' });
}

describe('IdempotencyService', () => {
  let service: IdempotencyService;

  beforeEach(() => {
    service = new IdempotencyService();
    mockDb.idempotencyKey.create.mockReset();
    mockDb.idempotencyKey.findUnique.mockReset();
    mockDb.idempotencyKey.update.mockReset();
    mockDb.idempotencyKey.delete.mockReset();
  });

  describe('withIdempotency - key 未传', () => {
    it('undefined key → 直接执行 fn（不查 DB）', async () => {
      const fn = vi.fn().mockResolvedValue({ ok: true });
      const result = await service.withIdempotency('ORDER_CREATE', undefined, fn);

      expect(result).toEqual({ ok: true });
      expect(fn).toHaveBeenCalledTimes(1);
      expect(mockDb.idempotencyKey.create).not.toHaveBeenCalled();
    });

    it('空字符串 key → 直接执行 fn（向后兼容）', async () => {
      const fn = vi.fn().mockResolvedValue(42);
      const result = await service.withIdempotency('ORDER_CREATE', '', fn);

      expect(result).toBe(42);
      expect(mockDb.idempotencyKey.create).not.toHaveBeenCalled();
    });
  });

  describe('withIdempotency - 首次请求', () => {
    it('INSERT PENDING 成功 → 执行 fn → UPDATE SUCCESS + 缓存 responsePayload', async () => {
      mockDb.idempotencyKey.create.mockResolvedValue({});
      mockDb.idempotencyKey.update.mockResolvedValue({});

      const fn = vi.fn().mockResolvedValue({ orderId: 'order-1', status: 'PENDING_PAYMENT' });
      const result = await service.withIdempotency('ORDER_CREATE', 'key-abc', fn);

      expect(result).toEqual({ orderId: 'order-1', status: 'PENDING_PAYMENT' });
      expect(fn).toHaveBeenCalledTimes(1);
      expect(mockDb.idempotencyKey.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          scene: 'ORDER_CREATE',
          key: 'key-abc',
          status: 'PENDING',
        }),
      });
      expect(mockDb.idempotencyKey.update).toHaveBeenCalledWith({
        where: { scene_key: { scene: 'ORDER_CREATE', key: 'key-abc' } },
        data: {
          status: 'SUCCESS',
          responsePayload: { orderId: 'order-1', status: 'PENDING_PAYMENT' },
        },
      });
    });

    it('fn 抛错 → UPDATE FAILED + 原错误透传', async () => {
      mockDb.idempotencyKey.create.mockResolvedValue({});
      mockDb.idempotencyKey.update.mockResolvedValue({});

      const fn = vi.fn().mockRejectedValue(new Error('STOCK_NOT_ENOUGH'));
      await expect(service.withIdempotency('ORDER_CREATE', 'key-fail', fn)).rejects.toThrow(
        /STOCK_NOT_ENOUGH/,
      );

      expect(mockDb.idempotencyKey.update).toHaveBeenCalledWith({
        where: { scene_key: { scene: 'ORDER_CREATE', key: 'key-fail' } },
        data: { status: 'FAILED' },
      });
    });

    it('fn 抛错且 UPDATE FAILED 也失败 → 原错误透传（不掩盖）', async () => {
      mockDb.idempotencyKey.create.mockResolvedValue({});
      mockDb.idempotencyKey.update.mockRejectedValue(new Error('redis down'));

      const fn = vi.fn().mockRejectedValue(new Error('BIZ_ERROR'));
      await expect(service.withIdempotency('ORDER_CREATE', 'key-fail2', fn)).rejects.toThrow(
        /BIZ_ERROR/,
      );
    });
  });

  describe('withIdempotency - 同 key 重试', () => {
    it('SUCCESS → 返回缓存 responsePayload（不再执行 fn）', async () => {
      mockDb.idempotencyKey.create.mockRejectedValue(uniqueViolation());
      mockDb.idempotencyKey.findUnique.mockResolvedValue({
        id: 'id-1',
        scene: 'ORDER_CREATE',
        key: 'key-retry',
        status: 'SUCCESS',
        responsePayload: { orderId: 'order-cached', cached: true },
        expiresAt: new Date(Date.now() + 60_000),
      });

      const fn = vi.fn().mockResolvedValue({ orderId: 'should-not-call' });
      const result = await service.withIdempotency('ORDER_CREATE', 'key-retry', fn);

      expect(result).toEqual({ orderId: 'order-cached', cached: true });
      expect(fn).not.toHaveBeenCalled();
    });

    it('PENDING → 抛 IdempotencyConcurrentException（409）', async () => {
      mockDb.idempotencyKey.create.mockRejectedValue(uniqueViolation());
      mockDb.idempotencyKey.findUnique.mockResolvedValue({
        id: 'id-2',
        status: 'PENDING',
        responsePayload: null,
        createdAt: new Date(), // 刚创建（未触发 stuck-pending）
        expiresAt: new Date(Date.now() + 60_000),
      });

      const fn = vi.fn();
      await expect(service.withIdempotency('ORDER_CREATE', 'key-pending', fn)).rejects.toThrow(
        IdempotencyConcurrentException,
      );
      expect(fn).not.toHaveBeenCalled();
    });

    it('FAILED → 抛 IdempotencyConcurrentException', async () => {
      mockDb.idempotencyKey.create.mockRejectedValue(uniqueViolation());
      mockDb.idempotencyKey.findUnique.mockResolvedValue({
        id: 'id-3',
        status: 'FAILED',
        responsePayload: null,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      const fn = vi.fn();
      await expect(service.withIdempotency('ORDER_CREATE', 'key-failed', fn)).rejects.toThrow(
        /already FAILED/,
      );
    });

    it('S4：PENDING > 5min → stuck-pending 删旧重建', async () => {
      mockDb.idempotencyKey.create
        .mockRejectedValueOnce(uniqueViolation())
        .mockResolvedValueOnce({});
      mockDb.idempotencyKey.findUnique.mockResolvedValue({
        id: 'id-stuck',
        status: 'PENDING',
        responsePayload: null,
        createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 分钟前（超过 5min 阈值）
        expiresAt: new Date(Date.now() + 60_000), // 未过期
      });
      mockDb.idempotencyKey.delete.mockResolvedValue({});
      mockDb.idempotencyKey.update.mockResolvedValue({});

      const fn = vi.fn().mockResolvedValue({ recovered: true });
      const result = await service.withIdempotency('ORDER_CREATE', 'key-stuck', fn);

      expect(result).toEqual({ recovered: true });
      expect(mockDb.idempotencyKey.delete).toHaveBeenCalledWith({ where: { id: 'id-stuck' } });
    });

    it('V2-B1：delete 连续失败导致 create 反复撞 unique → 抛 RECURSION_LIMIT（max=3）', async () => {
      // 场景：create 永远撞 unique（delete 后另一线程又写入）+ findUnique 永远返回过期记录
      // 触发 handleExistingKey 反复 delete + withIdempotency 重建
      mockDb.idempotencyKey.create.mockRejectedValue(uniqueViolation());
      mockDb.idempotencyKey.findUnique.mockResolvedValue({
        id: 'id-loop',
        status: 'PENDING',
        responsePayload: null,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() - 60_000), // 过期 → 触发 delete
      });
      mockDb.idempotencyKey.delete.mockResolvedValue({});
      mockDb.idempotencyKey.update.mockResolvedValue({});

      const fn = vi.fn().mockResolvedValue({ never: true });
      await expect(
        service.withIdempotency('ORDER_CREATE', 'key-loop', fn),
      ).rejects.toThrow(/RECURSION_LIMIT/);

      // fn 不应被执行（限制触发前）
      expect(fn).not.toHaveBeenCalled();
      // delete 至少 3 次（depth=0/1/2 都触发了 delete）
      expect(mockDb.idempotencyKey.delete.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('withIdempotency - 过期清理', () => {
    it('expiresAt < now → delete + 递归调（重新执行）', async () => {
      mockDb.idempotencyKey.create
        .mockRejectedValueOnce(uniqueViolation())
        .mockResolvedValueOnce({}); // 第二次 INSERT 成功
      mockDb.idempotencyKey.findUnique.mockResolvedValue({
        id: 'id-old',
        status: 'PENDING',
        responsePayload: null,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() - 60_000), // 1 分钟前过期
      });
      mockDb.idempotencyKey.delete.mockResolvedValue({});
      mockDb.idempotencyKey.update.mockResolvedValue({});

      const fn = vi.fn().mockResolvedValue({ fresh: true });
      const result = await service.withIdempotency('ORDER_CREATE', 'key-expired', fn);

      expect(result).toEqual({ fresh: true });
      expect(mockDb.idempotencyKey.delete).toHaveBeenCalledWith({ where: { id: 'id-old' } });
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
