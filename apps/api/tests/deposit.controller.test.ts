/**
 * DepositController A1 守卫测试（保证金批A T1-a，2026-09-10）
 *
 * 覆盖（幽灵 token 台账条目 1）：
 *   - NODE_ENV=production 下 pay-mock → 403 E-DEPOSIT-008（不触 service）
 *   - NODE_ENV=development 下 pay-mock 正常走 service（守卫不误伤 dev/staging）
 *
 * 单测直接 new Controller（不经 DI 容器 / Guard），只验 controller 层门控逻辑；
 * 管线/守卫链行为属 e2e 范畴（controller zod 测试盲区先例）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { RiderDepositController } from '../src/modules/rider/deposit.controller';

describe('RiderDepositController payMock 生产门控（批A T1-a）', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;
  let controller: RiderDepositController;
  const payMockSpy = vi.fn();

  beforeEach(() => {
    payMockSpy.mockReset();
    controller = new RiderDepositController({ payMock: payMockSpy } as never);
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
  });

  it('production 下 pay-mock → 403 E-DEPOSIT-008，不触 service', async () => {
    process.env.NODE_ENV = 'production';
    await expect(
      controller.payMock('3f2504e0-4f89-11d3-9a0c-0305e82c3301', {
        user: { sub: 'rider-u1' } as never,
      } as never),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'E-DEPOSIT-008' },
    });
    expect(payMockSpy).not.toHaveBeenCalled();
  });

  it('development 下 pay-mock 不受守卫影响（正常走 service）', async () => {
    process.env.NODE_ENV = 'development';
    payMockSpy.mockResolvedValue({ id: 'dep-1', status: 'CONFIRMED' });
    const result = await controller.payMock('3f2504e0-4f89-11d3-9a0c-0305e82c3301', {
      user: { sub: 'rider-u1' } as never,
    } as never);
    expect(result).toEqual({ success: true, data: { id: 'dep-1', status: 'CONFIRMED' } });
    expect(payMockSpy).toHaveBeenCalledWith('rider-u1', '3f2504e0-4f89-11d3-9a0c-0305e82c3301');
  });

  it('production 下抛的是 HttpException（保持 403 语义，非 500）', async () => {
    process.env.NODE_ENV = 'production';
    try {
      await controller.payMock('3f2504e0-4f89-11d3-9a0c-0305e82c3301', {
        user: { sub: 'rider-u1' } as never,
      } as never);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
    }
  });
});
