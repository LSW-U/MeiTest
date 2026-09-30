/**
 * DepositController pay-mock 守卫测试（批A T1-a → 批1 白名单收紧，2026-10-01）
 *
 * 覆盖（幽灵 token 台账条目 1 + 后端依赖专项批1）：
 *   - NODE_ENV=production 下 pay-mock → 403 E-DEPOSIT-008（不触 service，开关无关）
 *   - 默认关闭：NODE_ENV 非 production 且 PAY_MOCK_ENABLED 未设置/false → 403
 *   - 显式放行：NODE_ENV 非 production + PAY_MOCK_ENABLED='true' → 走 service
 *   - 审计日志存在：payMock 端点挂 @Audit({resource:'RiderDeposit'})（装饰器断言，
 *     装饰器元数据 reflector 可读；端点级审计写入断言属 e2e/集成范畴）
 *
 * 单测直接 new Controller（不经 DI 容器 / Guard），只验 controller 层门控逻辑；
 * 管线/守卫链行为属 e2e 范畴（controller zod 测试盲区先例）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { RiderDepositController } from '../src/modules/rider/deposit.controller';
import { Audit, AUDIT_KEY } from '../src/shared/decorators/audit.decorator';

describe('RiderDepositController payMock 生产门控（批A T1-a → 批1 白名单收紧）', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;
  const ORIGINAL_MOCK_FLAG = process.env.PAY_MOCK_ENABLED;
  let controller: RiderDepositController;
  const payMockSpy = vi.fn();

  beforeEach(() => {
    payMockSpy.mockReset();
    controller = new RiderDepositController({ payMock: payMockSpy } as never);
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
    if (ORIGINAL_MOCK_FLAG === undefined) {
      delete process.env.PAY_MOCK_ENABLED;
    } else {
      process.env.PAY_MOCK_ENABLED = ORIGINAL_MOCK_FLAG;
    }
  });

  it('production 下 pay-mock → 403 E-DEPOSIT-008，不触 service（开关无关）', async () => {
    process.env.NODE_ENV = 'production';
    // 开关无关：即使显式设 true，生产也恒 403
    process.env.PAY_MOCK_ENABLED = 'true';
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

  it('production 下 PAY_MOCK_ENABLED 未设置也 403', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.PAY_MOCK_ENABLED;
    await expect(
      controller.payMock('3f2504e0-4f89-11d3-9a0c-0305e82c3301', {
        user: { sub: 'rider-u1' } as never,
      } as never),
    ).rejects.toMatchObject({ status: 403, response: { code: 'E-DEPOSIT-008' } });
  });

  it('默认关闭：NODE_ENV 非 production 且 PAY_MOCK_ENABLED 未设置 → 403（R9：dev 默认也拒）', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.PAY_MOCK_ENABLED;
    await expect(
      controller.payMock('3f2504e0-4f89-11d3-9a0c-0305e82c3301', {
        user: { sub: 'rider-u1' } as never,
      } as never),
    ).rejects.toMatchObject({ status: 403, response: { code: 'E-DEPOSIT-008' } });
    expect(payMockSpy).not.toHaveBeenCalled();
  });

  it('默认关闭：PAY_MOCK_ENABLED=false → 403', async () => {
    process.env.NODE_ENV = 'development';
    process.env.PAY_MOCK_ENABLED = 'false';
    await expect(
      controller.payMock('3f2504e0-4f89-11d3-9a0c-0305e82c3301', {
        user: { sub: 'rider-u1' } as never,
      } as never),
    ).rejects.toMatchObject({ status: 403, response: { code: 'E-DEPOSIT-008' } });
    expect(payMockSpy).not.toHaveBeenCalled();
  });

  it('显式放行：非 production + PAY_MOCK_ENABLED=true → 正常走 service', async () => {
    process.env.NODE_ENV = 'development';
    process.env.PAY_MOCK_ENABLED = 'true';
    payMockSpy.mockResolvedValue({ id: 'dep-1', status: 'CONFIRMED' });
    const result = await controller.payMock('3f2504e0-4f89-11d3-9a0c-0305e82c3301', {
      user: { sub: 'rider-u1' } as never,
    } as never);
    expect(result).toEqual({ success: true, data: { id: 'dep-1', status: 'CONFIRMED' } });
    expect(payMockSpy).toHaveBeenCalledWith('rider-u1', '3f2504e0-4f89-11d3-9a0c-0305e82c3301');
  });

  it('production 下抛的是 HttpException（保持 403 语义，非 500）', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.PAY_MOCK_ENABLED;
    try {
      await controller.payMock('3f2504e0-4f89-11d3-9a0c-0305e82c3301', {
        user: { sub: 'rider-u1' } as never,
      } as never);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
    }
  });

  it('审计日志存在：payMock 端点挂 @Audit({resource:"RiderDeposit"})（装饰器断言）', () => {
    // @Audit 经 SetMetadata(AUDIT_KEY, options) 把元数据挂在 payMock 方法函数上，
    // 直接按 AUDIT_KEY 常量读回断言（精确，不靠 getMetadataKeys 过滤）
    const payMockMethod = RiderDepositController.prototype.payMock;
    const auditOptions = Reflect.getMetadata(AUDIT_KEY, payMockMethod);
    expect(auditOptions).toEqual({ resource: 'RiderDeposit' });
  });
});
