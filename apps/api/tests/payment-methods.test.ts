/**
 * PaymentService.listMethods 单测（W7 P1-1）
 *
 * 覆盖：
 *   - 返回 5 种方式（COD/BANK_TRANSFER/WECHAT/PAYPAL/STRIPE）
 *   - 每条含 name/subtitle 多语言 JSON（en/zh/id/pt/tet）
 *   - COD 是 isDefault=true，其他 isDefault=false
 *   - 全部 enabled=true（MVP 阶段）
 *   - mockFlag 从 strategy.isMock 派生：COD/BANK_TRANSFER=false，WECHAT/PAYPAL/STRIPE=true
 *   - icon 字段存在（cod/bank/wechat/paypal/stripe）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PaymentService } from '../src/modules/payment/payment.service';

describe('PaymentService.listMethods', () => {
  let service: PaymentService;

  beforeEach(() => {
    service = new PaymentService();
  });

  it('返回 5 种支付方式', async () => {
    const items = await service.listMethods();
    expect(items).toHaveLength(5);
    const codes = items.map((i) => i.code).sort();
    expect(codes).toEqual(['BANK_TRANSFER', 'COD', 'PAYPAL', 'STRIPE', 'WECHAT']);
  });

  it('每条含 5 语言 name/subtitle', async () => {
    const items = await service.listMethods();
    for (const item of items) {
      expect(Object.keys(item.name).sort()).toEqual(['en', 'id', 'pt', 'tet', 'zh']);
      expect(Object.keys(item.subtitle).sort()).toEqual(['en', 'id', 'pt', 'tet', 'zh']);
      // 每语言都有非空字符串
      for (const lang of ['en', 'zh', 'id', 'pt', 'tet']) {
        expect(item.name[lang].length).toBeGreaterThan(0);
        expect(item.subtitle[lang].length).toBeGreaterThan(0);
      }
    }
  });

  it('COD 是 isDefault=true，其他 isDefault=false', async () => {
    const items = await service.listMethods();
    const cod = items.find((i) => i.code === 'COD');
    expect(cod?.isDefault).toBe(true);
    const others = items.filter((i) => i.code !== 'COD');
    expect(others.every((i) => i.isDefault === false)).toBe(true);
  });

  it('全部 enabled=true（MVP 阶段全开）', async () => {
    const items = await service.listMethods();
    expect(items.every((i) => i.enabled === true)).toBe(true);
  });

  it('mockFlag 从 strategy 派生：COD/BANK_TRANSFER=false，WECHAT/PAYPAL/STRIPE=true', async () => {
    const items = await service.listMethods();
    const byCode = Object.fromEntries(items.map((i) => [i.code, i.mockFlag]));
    expect(byCode.COD).toBe(false);
    expect(byCode.BANK_TRANSFER).toBe(false);
    expect(byCode.WECHAT).toBe(true);
    expect(byCode.PAYPAL).toBe(true);
    expect(byCode.STRIPE).toBe(true);
  });

  it('icon 字段为非空字符串', async () => {
    const items = await service.listMethods();
    for (const item of items) {
      expect(typeof item.icon).toBe('string');
      expect(item.icon.length).toBeGreaterThan(0);
    }
    // 验证具体值（前端按此渲染本地资源）
    const byCode = Object.fromEntries(items.map((i) => [i.code, i.icon]));
    expect(byCode.COD).toBe('cod');
    expect(byCode.BANK_TRANSFER).toBe('bank');
    expect(byCode.WECHAT).toBe('wechat');
    expect(byCode.PAYPAL).toBe('paypal');
    expect(byCode.STRIPE).toBe('stripe');
  });

  it('COD 排在第一位（推荐顺序）', async () => {
    const items = await service.listMethods();
    expect(items[0].code).toBe('COD');
  });
});
