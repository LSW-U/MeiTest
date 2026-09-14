/**
 * SMS 回执 webhook 骨架单测（批A R16 · 步骤9）
 *
 * 覆盖：开关关忽略（E-SMS-007 不验签）/ 开关开+签名缺失拒 401（Q4 防伪造）/
 *       secret 未配置 fail-closed / 有效签名放行（recorded:false 骨架态）/
 *       错误签名拒 401 / sha256= 前缀兼容剥离 / timingSafeEqual 长度不符拒。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';

vi.mock('../src/shared/logger/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { SmsReceiptWebhookController, verifySmsReceiptSignature } from '../src/modules/notification/sms-receipt.controller';
import { logger } from '../src/shared/logger/logger';

const warnSpy = logger.warn as ReturnType<typeof vi.fn>;
const SECRET = 'test-webhook-secret';

describe('SMS 回执 webhook（R16 留接口骨架）', () => {
  const controller = new SmsReceiptWebhookController();
  const payload = { messageId: 'gw-123', status: 'delivered', to: '+6707123456' };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SMS_RECEIPT_WEBHOOK_ENABLED;
    delete process.env.SMS_RECEIPT_WEBHOOK_SECRET;
  });

  afterEach(() => {
    delete process.env.SMS_RECEIPT_WEBHOOK_ENABLED;
    delete process.env.SMS_RECEIPT_WEBHOOK_SECRET;
  });

  it('开关关（默认）→ 忽略返回 E-SMS-007，不验签不落库', async () => {
    const res = await controller.receive(payload, { 'x-sms-signature': 'whatever' });
    expect(res).toEqual({ success: false, recorded: false, code: 'E-SMS-007' });
    expect(warnSpy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'DISABLED' }));
  });

  it('开关开 + 签名缺失 → 401 Unauthorized（Q4 防伪造，fail-closed）', async () => {
    process.env.SMS_RECEIPT_WEBHOOK_ENABLED = 'true';
    process.env.SMS_RECEIPT_WEBHOOK_SECRET = SECRET;
    await expect(controller.receive(payload, {})).rejects.toThrow(UnauthorizedException);
  });

  it('开关开 + secret 未配置 → 401（fail-closed，不因漏配放行）', async () => {
    process.env.SMS_RECEIPT_WEBHOOK_ENABLED = 'true';
    const sig = createHmac('sha256', SECRET).update(JSON.stringify(payload)).digest('hex');
    await expect(controller.receive(payload, { 'x-sms-signature': sig })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('开关开 + 有效签名 → 放行（recorded:false 骨架态，待选型落库）', async () => {
    process.env.SMS_RECEIPT_WEBHOOK_ENABLED = 'true';
    process.env.SMS_RECEIPT_WEBHOOK_SECRET = SECRET;
    const sig = createHmac('sha256', SECRET).update(JSON.stringify(payload)).digest('hex');
    const res = await controller.receive(payload, { 'x-sms-signature': sig });
    expect(res).toEqual({ success: true, recorded: false });
  });

  it('错误签名 → 401', async () => {
    process.env.SMS_RECEIPT_WEBHOOK_ENABLED = 'true';
    process.env.SMS_RECEIPT_WEBHOOK_SECRET = SECRET;
    await expect(
      controller.receive(payload, { 'x-sms-signature': 'deadbeef'.repeat(8) }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('verifySmsReceiptSignature：sha256= 前缀兼容剥离 + 长度不符拒（timingSafeEqual 前置）', () => {
    process.env.SMS_RECEIPT_WEBHOOK_SECRET = SECRET;
    const raw = JSON.stringify(payload);
    const sig = createHmac('sha256', SECRET).update(raw).digest('hex');
    expect(verifySmsReceiptSignature(raw, `sha256=${sig}`)).toBe(true);
    expect(verifySmsReceiptSignature(raw, 'short')).toBe(false);
    expect(verifySmsReceiptSignature(raw, null)).toBe(false);
    // body 被改 → 不匹配
    expect(verifySmsReceiptSignature(JSON.stringify({ ...payload, status: 'failed' }), sig)).toBe(
      false,
    );
  });
});
