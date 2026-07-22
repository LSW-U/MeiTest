/**
 * registration-ticket 单测（W7-ext-H）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: { set: vi.fn(), eval: vi.fn() },
}));

vi.mock('../src/shared/cache/redis', () => ({ redis: mockRedis }));

import { createTicket, consumeTicket } from '../src/shared/cache/registration-ticket';

describe('registration-ticket', () => {
  beforeEach(() => vi.resetAllMocks());

  describe('createTicket', () => {
    it('生成不透明 ticket + Redis 存哈希', async () => {
      mockRedis.set.mockResolvedValue('OK');
      const ticket = await createTicket({ phone: '+67012345678', challengeId: 'ch-1' });
      expect(ticket).toBeTruthy();
      expect(typeof ticket).toBe('string');
      // Redis.set 被调，key 是 register:ticket:{hash}（不含明文 ticket）
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^register:ticket:[a-f0-9]{64}$/),
        expect.stringContaining('"phone":"+67012345678"'),
        'EX',
        300,
      );
    });
  });

  describe('consumeTicket', () => {
    it('OK: GETDEL 返回 ticket data', async () => {
      const ticketData = {
        phone: '+67012345678',
        challengeId: 'ch-1',
        purpose: 'COMPLETE_BUYER_REGISTRATION',
        verifiedAt: 1,
        expiresAt: 2,
      };
      mockRedis.eval.mockResolvedValue(JSON.stringify(ticketData));
      const result = await consumeTicket('some-ticket-plain');
      expect(result.status).toBe('OK');
      if (result.status === 'OK') {
        expect(result.data.phone).toBe('+67012345678');
        expect(result.data.challengeId).toBe('ch-1');
      }
    });

    it('INVALID_OR_USED: GETDEL 返回 nil', async () => {
      mockRedis.eval.mockResolvedValue(null);
      const result = await consumeTicket('nonexistent-ticket');
      expect(result.status).toBe('INVALID_OR_USED');
    });

    it('明文 ticket 不同 -> hash 不同 -> key 不同（防猜）', async () => {
      mockRedis.eval.mockResolvedValue(null);
      await consumeTicket('ticket-a');
      await consumeTicket('ticket-b');
      // 两次 eval 的 key 参数不同
      const call1 = mockRedis.eval.mock.calls[0][2];
      const call2 = mockRedis.eval.mock.calls[1][2];
      expect(call1).not.toBe(call2);
      expect(call1).toMatch(/^register:ticket:[a-f0-9]{64}$/);
    });
  });
});
