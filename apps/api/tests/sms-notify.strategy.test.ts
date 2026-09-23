/**
 * SmsNotifyStrategy 单测（批A R18+R21，2026-09-15）
 *
 * 覆盖（任务书 ≥4 例）：
 *   - 开关关（默认）→ stub 行为（mockFlag:true，[SMS_STUB] 日志，不查库不发网关）
 *   - 开关开 → 真实网关发送（mock fetch 链路；sendSmsViaGateway 整体 mock，
 *     网关 HTTP 细节已由 sms.strategy.provider.test.ts 覆盖，此处不重复）
 *   - 缺号 / 查库失败 → 降级 success:false 不抛（R18 绝不 fail-fast）
 *   - 日配额超限 → 拒发 success:false（R21）
 *
 * 白盒直调 new SmsNotifyStrategy()（不经 DI 容器，同 rate-limit-guard.test.ts 范式）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRedis, mockUserFindUnique, mockSendViaGateway } = vi.hoisted(() => ({
  mockRedis: { incr: vi.fn(), expire: vi.fn() },
  mockUserFindUnique: vi.fn(),
  mockSendViaGateway: vi.fn(),
}));

vi.mock('../src/shared/cache', () => ({ redis: mockRedis }));
vi.mock('../src/shared/db', () => ({ db: { user: { findUnique: mockUserFindUnique } } }));
vi.mock('../src/infrastructure/otp/sms-gateway.client', () => ({
  readSmsGatewayConfig: vi.fn(() => ({
    url: 'https://gw.example.com/send',
    authHeader: 'Authorization',
    authValue: 'Bearer test',
    payloadTemplate: '{"to":"{{phone}}","text":"{{text}}"}',
  })),
  sendSmsViaGateway: mockSendViaGateway,
  // P3-1 修复后 maskSmsPhone 定义在本模块（notify 策略从此 import），mock 需保留
  maskSmsPhone: (p: string) => (p.length < 6 ? '***' : p.slice(0, 4) + '****' + p.slice(-2)),
}));

import { SmsNotifyStrategy, smsNotifyQuotaKey } from '../src/infrastructure/notify/sms.strategy';
import { clearSmsProviderCache } from '../src/infrastructure/otp/sms.strategy';

const strategy = new SmsNotifyStrategy();

const baseRequest = {
  userId: 'user-1',
  channel: 'SMS' as const,
  type: 'ORDER_STATUS' as const,
  title: { en: 'Order Confirmed' },
  body: { en: 'Your order has been confirmed.' },
};

describe('SmsNotifyStrategy 开关关 → stub（R21）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SMS_NOTIFY_ENABLED;
  });

  it('SMS_NOTIFY_ENABLED 未设置 → stub 成功（mockFlag:true，不查库不查配额不发网关）', async () => {
    const r = await strategy.send(baseRequest);
    expect(r.success).toBe(true);
    expect(r.mockFlag).toBe(true);
    expect(r.messageId).toMatch(/^mock_sms_/);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockSendViaGateway).not.toHaveBeenCalled();
    expect(mockRedis.incr).not.toHaveBeenCalled();
  });

  it('SMS_NOTIFY_ENABLED=false 显式关 → 同 stub', async () => {
    process.env.SMS_NOTIFY_ENABLED = 'false';
    const r = await strategy.send(baseRequest);
    expect(r.mockFlag).toBe(true);
    expect(mockSendViaGateway).not.toHaveBeenCalled();
  });
});

describe('SmsNotifyStrategy 开关开 → 真实网关（R18+R21）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SMS_NOTIFY_ENABLED = 'true';
    mockRedis.incr.mockResolvedValue(1);
    mockUserFindUnique.mockResolvedValue({ phone: '+67077777777' });
    mockSendViaGateway.mockResolvedValue({ messageId: 'gw-123' });
  });
  afterEach(() => {
    delete process.env.SMS_NOTIFY_ENABLED;
    delete process.env.SMS_NOTIFY_DAILY_LIMIT;
    delete process.env.SMS_PROVIDER;
    clearSmsProviderCache(); // 批A2-1：notify provider 解析读 otp 侧缓存，测试后重置
  });

  it('正常路径：查号 → 配额 INCR → 网关发送，success:true mockFlag:false', async () => {
    const r = await strategy.send(baseRequest);
    expect(r).toEqual({ success: true, messageId: 'gw-123', mockFlag: false });
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { phone: true },
    });
    expect(mockRedis.incr).toHaveBeenCalledWith(expect.stringMatching(/^sms:notify:daily:\d{4}-\d{2}-\d{2}$/));
    expect(mockSendViaGateway).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://gw.example.com/send' }),
      '+67077777777',
      'Your order has been confirmed.',
    );
  });

  it('locale 取用户偏好语：body[locale] 优先于 en', async () => {
    await strategy.send({ ...baseRequest, locale: 'zh', body: { en: 'EN', zh: 'ZH' } });
    expect(mockSendViaGateway).toHaveBeenCalledWith(expect.anything(), '+67077777777', 'ZH');
  });

  it('缺号（User 无 phone）→ 降级 success:false，不抛不查配额不发网关（R18）', async () => {
    mockUserFindUnique.mockResolvedValue({ phone: null });
    const r = await strategy.send(baseRequest);
    expect(r.success).toBe(false);
    expect(r.error).toContain('E-SMS-004');
    expect(mockSendViaGateway).not.toHaveBeenCalled();
    expect(mockRedis.incr).not.toHaveBeenCalled();
  });

  it('查库抛错 → 降级 success:false 不抛（R18 三层容错第 1 层）', async () => {
    mockUserFindUnique.mockRejectedValue(new Error('db down'));
    const r = await strategy.send(baseRequest);
    expect(r.success).toBe(false);
    expect(r.error).toContain('E-SMS-003');
    expect(mockSendViaGateway).not.toHaveBeenCalled();
  });

  it('日配额超限 → 拒发 success:false 不发网关（R21）', async () => {
    process.env.SMS_NOTIFY_DAILY_LIMIT = '2';
    mockRedis.incr.mockResolvedValue(3); // 第 3 条 > limit 2
    const r = await strategy.send(baseRequest);
    expect(r.success).toBe(false);
    expect(r.error).toContain('E-SMS-005');
    expect(mockSendViaGateway).not.toHaveBeenCalled();
  });

  it('配额内（count == limit）→ 正常发送', async () => {
    process.env.SMS_NOTIFY_DAILY_LIMIT = '5';
    mockRedis.incr.mockResolvedValue(5);
    const r = await strategy.send(baseRequest);
    expect(r.success).toBe(true);
  });

  it('配额键按 UTC 日命名且首条设 TTL（sms:notify:* 命名空间）', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await strategy.send(baseRequest);
    expect(mockRedis.incr).toHaveBeenCalledWith(`sms:notify:daily:${today}`);
    expect(mockRedis.expire).toHaveBeenCalledWith(`sms:notify:daily:${today}`, 2 * 24 * 3600);
  });

  it('网关发送抛错 → 降级 success:false 不抛（SmsGatewayError 不外泄）', async () => {
    mockSendViaGateway.mockRejectedValue(new Error('GATEWAY_HTTP_500'));
    const r = await strategy.send(baseRequest);
    expect(r.success).toBe(false);
    expect(r.error).toContain('E-SMS-006');
  });

  it('策略内部未分类异常也降级不抛（try/catch 兜底最后一道）', async () => {
    mockRedis.incr.mockRejectedValue(new Error('redis down'));
    const r = await strategy.send(baseRequest);
    expect(r.success).toBe(false);
    expect(r.error).toContain('E-SMS-006');
  });
});

describe('SmsNotifyStrategy provider 兼容 tencent（批A2-1 任务书 #3）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SMS_NOTIFY_ENABLED = 'true';
    mockRedis.incr.mockResolvedValue(1);
    mockUserFindUnique.mockResolvedValue({ phone: '+67077777777' });
    mockSendViaGateway.mockResolvedValue({ messageId: 'gw-123' });
  });
  afterEach(() => {
    delete process.env.SMS_NOTIFY_ENABLED;
    delete process.env.SMS_PROVIDER;
    clearSmsProviderCache();
  });

  it('SMS_PROVIDER=tencent + 开关开 → 识别为 tencent 未接线，降级 success:false 不发网关不查配额', async () => {
    process.env.SMS_PROVIDER = 'tencent';
    clearSmsProviderCache();
    const r = await strategy.send(baseRequest);
    expect(r.success).toBe(false);
    expect(r.mockFlag).toBe(false);
    expect(r.error).toContain('E-SMS-002');
    expect(mockSendViaGateway).not.toHaveBeenCalled();
    expect(mockRedis.incr).not.toHaveBeenCalled(); // 未达配额步骤
    expect(mockUserFindUnique).not.toHaveBeenCalled(); // provider 检查在最前
  });

  it('SMS_PROVIDER=tencent + 开关关 → 仍走 stub（默认行为不变）', async () => {
    process.env.SMS_PROVIDER = 'tencent';
    delete process.env.SMS_NOTIFY_ENABLED;
    clearSmsProviderCache();
    const r = await strategy.send(baseRequest);
    expect(r.success).toBe(true);
    expect(r.mockFlag).toBe(true);
    expect(mockSendViaGateway).not.toHaveBeenCalled();
  });

  it('SMS_PROVIDER=gateway + 开关开 → 不触发 tencent 分支，正常网关发送（回归）', async () => {
    process.env.SMS_PROVIDER = 'gateway';
    clearSmsProviderCache();
    const r = await strategy.send(baseRequest);
    expect(r).toEqual({ success: true, messageId: 'gw-123', mockFlag: false });
  });
});
