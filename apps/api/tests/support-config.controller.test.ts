/**
 * SupportConfigController 单测（P5 #1，2026-08-25）
 *
 * 覆盖：
 *   - getConfig: support.phone + support.hours 都命中 → 返回完整 view
 *   - getConfig: hours 缺失 → 返回 hours=""（phone 存在即放行）
 *   - getConfig: phone 缺失（未 seed）→ NotFoundException + E-PLATFORM-003
 *
 * Mock SystemConfigService.get（不 mock db/redis，因为 controller 只依赖 service）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SupportConfigController } from '../src/modules/platform/support-config.controller';
import type { SystemConfigService } from '../src/modules/platform/system-config.service';

const configGet = vi.fn();
const configService = { get: configGet } as unknown as SystemConfigService;

describe('SupportConfigController.getConfig - P5 #1 客服配置下发', () => {
  let controller: SupportConfigController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new SupportConfigController(configService);
  });

  it('phone + hours 都命中 → 返回完整 view', async () => {
    configGet.mockImplementation((key: string) => {
      if (key === 'support.phone') return Promise.resolve('+6707700000');
      if (key === 'support.hours') return Promise.resolve('Mon-Sun 08:00-20:00');
      return Promise.resolve(null);
    });

    const res = await controller.getConfig();

    expect(res.success).toBe(true);
    expect(res.data.phone).toBe('+6707700000');
    expect(res.data.hours).toBe('Mon-Sun 08:00-20:00');
    expect(configGet).toHaveBeenCalledWith('support.phone');
    expect(configGet).toHaveBeenCalledWith('support.hours');
  });

  it('hours 缺失 → 返回 hours=""（phone 存在即放行）', async () => {
    configGet.mockImplementation((key: string) => {
      if (key === 'support.phone') return Promise.resolve('+6707700000');
      return Promise.resolve(null);
    });

    const res = await controller.getConfig();

    expect(res.data.phone).toBe('+6707700000');
    expect(res.data.hours).toBe('');
  });

  it('phone 缺失（未 seed）→ NotFoundException + E-PLATFORM-003', async () => {
    configGet.mockResolvedValue(null);

    await expect(controller.getConfig()).rejects.toThrow(NotFoundException);
    try {
      await controller.getConfig();
    } catch (e) {
      const exc = e as NotFoundException;
      const resp = exc.getResponse() as { code: string };
      expect(resp.code).toBe('E-PLATFORM-003');
    }
  });
});
