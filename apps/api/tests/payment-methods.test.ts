/**
 * PaymentService.listMethods 单测（W7 P1-1 + 批B 枚举补位，微信支付预留 2026-09-08，方案V2 §3.2）
 *
 * 覆盖：
 *   - 返回 8 种方式（5 原有 + WECHAT_GLOBAL/ALIPAY_CN/LOCAL_PSP 批B 补位）
 *   - 每条含 name/subtitle 多语言 JSON（en/zh/id/pt/tet）
 *   - COD 是 isDefault=true，其他 isDefault=false
 *   - 全部 enabled=true（MVP 阶段）
 *   - available 字段（批B）：5 原有渠道 true，3 占位渠道 false
 *   - mockFlag 从 strategy.isMock 派生：COD/BANK_TRANSFER=false，其余 6 渠道=true
 *   - icon 字段存在（cod/bank/wechat/paypal/stripe/wechat-global/alipay/local-psp）
 *   - 工厂注册完整性（PaymentProvider 抽象：PaymentMethodCode 全量可取 strategy）
 *   - 3 个新策略 stub 返回形状（STUB_ 事务号 + mockFlag + [STUB] method）
 *   - isPaymentMethodOrderable 下单判定（R2 判定口径：现有渠道放行 / 占位渠道拒绝）
 *   - 契约 safeParse 无空值（PaymentMethod 8 值 / PaymentMethodItem.available 必填）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Why: 3 个新策略 stub 的 createPayment 会 redis.set 记录时间戳（queryPayment 延迟窗口用），
// 单测环境 mock 掉 shared/cache，不依赖真实 Redis（CI 无 redis 服务）
const { mockRedis } = vi.hoisted(() => ({
  mockRedis: { set: vi.fn().mockResolvedValue('OK'), get: vi.fn().mockResolvedValue(null) },
}));
vi.mock('../src/shared/cache', () => ({ redis: mockRedis }));

import { PaymentService } from '../src/modules/payment/payment.service';
import {
  getPaymentStrategy,
  getAllPaymentStrategies,
  listMockPaymentStrategies,
} from '../src/infrastructure/payment/payment.factory';
import {
  WechatGlobalStrategy,
} from '../src/infrastructure/payment/wechat-global.strategy';
import { AlipayCnStrategy } from '../src/infrastructure/payment/alipay-cn.strategy';
import { LocalPspStrategy } from '../src/infrastructure/payment/local-psp.strategy';
import { isPaymentMethodOrderable } from '../src/modules/payment/payment-methods.config';
import { PaymentMethod, PaymentMethodItem } from '@meimart/api-contract';

const ALL_CODES = [
  'COD',
  'BANK_TRANSFER',
  'WECHAT',
  'PAYPAL',
  'STRIPE',
  'WECHAT_GLOBAL',
  'ALIPAY_CN',
  'LOCAL_PSP',
] as const;

const PLACEHOLDER_CODES = ['WECHAT_GLOBAL', 'ALIPAY_CN', 'LOCAL_PSP'];

describe('PaymentService.listMethods', () => {
  let service: PaymentService;

  beforeEach(() => {
    service = new PaymentService();
  });

  it('返回 8 种支付方式（5 原有 + 批B 补位 3 占位）', async () => {
    const items = await service.listMethods();
    expect(items).toHaveLength(8);
    const codes = items.map((i) => i.code).sort();
    expect(codes).toEqual([...ALL_CODES].sort());
  });

  it('每条含 5 语言 name/subtitle 且非空（契约无空值）', async () => {
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

  it('available 字段（批B）：5 原有渠道可下单，3 占位渠道 available=false', async () => {
    const items = await service.listMethods();
    const byCode = Object.fromEntries(items.map((i) => [i.code, i.available]));
    expect(byCode.COD).toBe(true);
    expect(byCode.BANK_TRANSFER).toBe(true);
    expect(byCode.WECHAT).toBe(true);
    expect(byCode.PAYPAL).toBe(true);
    expect(byCode.STRIPE).toBe(true);
    // 占位渠道：列表可见"即将上线"，不可下单
    expect(byCode.WECHAT_GLOBAL).toBe(false);
    expect(byCode.ALIPAY_CN).toBe(false);
    expect(byCode.LOCAL_PSP).toBe(false);
  });

  it('mockFlag 从 strategy 派生：COD/BANK_TRANSFER=false，其余 6 渠道=true', async () => {
    const items = await service.listMethods();
    const byCode = Object.fromEntries(items.map((i) => [i.code, i.mockFlag]));
    expect(byCode.COD).toBe(false);
    expect(byCode.BANK_TRANSFER).toBe(false);
    expect(byCode.WECHAT).toBe(true);
    expect(byCode.PAYPAL).toBe(true);
    expect(byCode.STRIPE).toBe(true);
    // 批B 3 占位渠道为 stub
    expect(byCode.WECHAT_GLOBAL).toBe(true);
    expect(byCode.ALIPAY_CN).toBe(true);
    expect(byCode.LOCAL_PSP).toBe(true);
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
    expect(byCode.WECHAT_GLOBAL).toBe('wechat-global');
    expect(byCode.ALIPAY_CN).toBe('alipay');
    expect(byCode.LOCAL_PSP).toBe('local-psp');
  });

  it('COD 排在第一位（推荐顺序），3 占位渠道排尾', async () => {
    const items = await service.listMethods();
    expect(items[0].code).toBe('COD');
    const lastThree = items.slice(-3).map((i) => i.code);
    expect(lastThree).toEqual(PLACEHOLDER_CODES);
  });

  it('WECHAT 语义固化：五语 name/subtitle 含"国内/中国主体"信息（批B）', async () => {
    const items = await service.listMethods();
    const wechat = items.find((i) => i.code === 'WECHAT');
    expect(wechat?.name.zh).toContain('国内');
    expect(wechat?.subtitle.zh).toContain('接口预留');
    expect(wechat?.subtitle.en).toContain('mainland China');
  });

  it('WECHAT_GLOBAL 语义固化：subtitle 注明"东帝汶不受理，仅占位"（批B）', async () => {
    const items = await service.listMethods();
    const wechatGlobal = items.find((i) => i.code === 'WECHAT_GLOBAL');
    expect(wechatGlobal?.subtitle.zh).toContain('东帝汶不受理');
  });
});

describe('支付工厂注册完整性（批B，PaymentProvider 抽象）', () => {
  it('PaymentMethodCode 全量 8 渠道均可取到 strategy', () => {
    for (const code of ALL_CODES) {
      const strategy = getPaymentStrategy(code);
      expect(strategy.method).toBe(code);
    }
  });

  it('getAllPaymentStrategies 返回 8 个，listMockPaymentStrategies 返回 6 个 stub', () => {
    expect(getAllPaymentStrategies()).toHaveLength(8);
    const mockCodes = listMockPaymentStrategies().map((s) => s.method).sort();
    expect(mockCodes).toEqual(['ALIPAY_CN', 'LOCAL_PSP', 'PAYPAL', 'STRIPE', 'WECHAT', 'WECHAT_GLOBAL']);
  });

  it('3 个新策略 stub 返回 STUB_ 事务号 + mockFlag=true + isMock=true', async () => {
    const stubs = [new WechatGlobalStrategy(), new AlipayCnStrategy(), new LocalPspStrategy()];
    for (const strategy of stubs) {
      expect(strategy.isMock).toBe(true);
      const intent = await strategy.createPayment({
        orderId: 'order-1',
        orderNo: 'MM2026090801000001',
        amount: 1000,
        paymentMethod: strategy.method,
      });
      expect(intent.transactionId).toMatch(/^STUB_/);
      expect(intent.transactionId).toContain(strategy.method);
      expect(intent.method).toBe(strategy.method);
      expect(intent.mockFlag).toBe(true);
      expect(intent.status).toBe('PROCESSING');
      expect(intent.amount).toBe(1000);
      // refund 返回 PENDING（stub 异步语义）
      const refund = await strategy.refund({ transactionId: intent.transactionId!, amount: 500 });
      expect(refund.status).toBe('PENDING');
      expect(refund.refundTransactionId).toMatch(/^STUB_/);
    }
  });
});

describe('isPaymentMethodOrderable 下单判定（批B R2 口径）', () => {
  it('现有 5 渠道放行（available=true）', () => {
    expect(isPaymentMethodOrderable('COD')).toBe(true);
    expect(isPaymentMethodOrderable('BANK_TRANSFER')).toBe(true);
    expect(isPaymentMethodOrderable('WECHAT')).toBe(true);
    expect(isPaymentMethodOrderable('PAYPAL')).toBe(true);
    expect(isPaymentMethodOrderable('STRIPE')).toBe(true);
  });

  it('3 占位渠道拒绝 + 不在 config 的渠道防御拒绝', () => {
    expect(isPaymentMethodOrderable('WECHAT_GLOBAL')).toBe(false);
    expect(isPaymentMethodOrderable('ALIPAY_CN')).toBe(false);
    expect(isPaymentMethodOrderable('LOCAL_PSP')).toBe(false);
    expect(isPaymentMethodOrderable('NOT_A_METHOD')).toBe(false);
  });
});

describe('契约 schema safeParse（批B：PaymentMethod 8 值 + PaymentMethodItem.available 必填）', () => {
  it('PaymentMethod 接受 8 值、拒绝未知值', () => {
    for (const code of ALL_CODES) {
      expect(PaymentMethod.safeParse(code).success).toBe(true);
    }
    expect(PaymentMethod.safeParse('NOT_A_METHOD').success).toBe(false);
  });

  it('PaymentMethodItem：available 为必填 boolean，缺字段解析失败（契约无空值）', () => {
    const base = {
      code: 'WECHAT_GLOBAL',
      name: { en: 'WeChat Pay (Global)', zh: '微信支付（国际版）' },
      subtitle: { en: 'placeholder', zh: '占位' },
      icon: 'wechat-global',
      isDefault: false,
      enabled: true,
      mockFlag: true,
    };
    // 带 available → 通过
    expect(PaymentMethodItem.safeParse({ ...base, available: false }).success).toBe(true);
    // 缺 available → 失败（防后端漏透传 / 前端拿到 undefined）
    expect(PaymentMethodItem.safeParse(base).success).toBe(false);
  });
});
