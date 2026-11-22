/**
 * SuggestionRefundRetryProcessor 单测（批3 P1-E，20261122）
 *
 * 覆盖：
 *   - 重试成功（refunded）→ 不落死信
 *   - 末次尝试仍失败（failed + attemptsMade=2 即第 3 次）→ 死信结构化日志 + captureException
 *   - 非末次失败：BullMQ 自行 backoff 重试，processor 不落死信（异常上抛交 BullMQ）
 *   - skipped（item 不缺）→ 无死信
 *   - 未知 job name → 不处理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockOrderService, mockCapture } = vi.hoisted(() => ({
  mockOrderService: {
    retrySuggestionTimeoutRefund: vi.fn(),
  },
  mockCapture: vi.fn(),
}));

vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/shared/monitoring/sentry', () => ({
  captureException: mockCapture,
}));

import { SuggestionRefundRetryProcessor } from '../src/modules/order/suggestion-refund-retry.processor';

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    name: 'refund-declined',
    data: { orderId: 'order-1', itemId: 'item-1' },
    attemptsMade: 0,
    ...overrides,
  } as never;
}

describe('SuggestionRefundRetryProcessor（批3 P1-E）', () => {
  let processor: SuggestionRefundRetryProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new SuggestionRefundRetryProcessor(mockOrderService as never);
  });

  it('重试成功（refunded）→ 不落死信', async () => {
    mockOrderService.retrySuggestionTimeoutRefund.mockResolvedValue({ status: 'refunded' });

    await processor.process(makeJob());

    expect(mockOrderService.retrySuggestionTimeoutRefund).toHaveBeenCalledWith('order-1', 'item-1');
    expect(mockCapture).not.toHaveBeenCalled();
    const { logger } = await import('../src/shared/logger/logger');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('skipped（item 不缺）→ 无死信', async () => {
    mockOrderService.retrySuggestionTimeoutRefund.mockResolvedValue({ status: 'skipped' });

    await processor.process(makeJob());

    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('3 次全败（末次 attemptsMade=2 + failed）→ 死信结构化日志 + captureException', async () => {
    mockOrderService.retrySuggestionTimeoutRefund.mockResolvedValue({
      status: 'failed',
      error: 'db down',
    });

    await processor.process(makeJob({ attemptsMade: 2 }));

    const { logger } = await import('../src/shared/logger/logger');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'SUGGESTION_REFUND_RETRY_DEAD_LETTER',
        orderId: 'order-1',
        itemId: 'item-1',
        attempts: 3,
        error: 'db down',
      }),
    );
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(String(mockCapture.mock.calls[0][0])).toContain('SUGGESTION_REFUND_RETRY_DEAD_LETTER');
  });

  // P1-1 修复（20261122）：非末次失败 → throw 交 BullMQ backoff（attempts:3 才真实计数）
  it('非末次失败（attemptsMade=0，第 1 次失败）→ process rejects（交 BullMQ backoff 重试），不落死信', async () => {
    mockOrderService.retrySuggestionTimeoutRefund.mockResolvedValue({
      status: 'failed',
      error: 'db down',
    });

    await expect(processor.process(makeJob({ attemptsMade: 0 }))).rejects.toThrow(
      /SUGGESTION_REFUND_RETRY_FAILED.*db down/,
    );

    expect(mockCapture).not.toHaveBeenCalled();
    const { logger } = await import('../src/shared/logger/logger');
    expect(logger.error).not.toHaveBeenCalledWith(expect.objectContaining({ msg: 'SUGGESTION_REFUND_RETRY_DEAD_LETTER' }));
  });

  // P1-1 修复：第 2 次尝试（attemptsMade=1）仍 failed → 同样抛错继续 backoff
  it('非末次失败（attemptsMade=1，第 2 次）→ process rejects 继续重试，不落死信', async () => {
    mockOrderService.retrySuggestionTimeoutRefund.mockResolvedValue({
      status: 'failed',
      error: 'db down',
    });

    await expect(processor.process(makeJob({ attemptsMade: 1 }))).rejects.toThrow(
      /SUGGESTION_REFUND_RETRY_FAILED/,
    );
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('未知 job name → 不处理', async () => {
    await processor.process(makeJob({ name: 'other' }));
    expect(mockOrderService.retrySuggestionTimeoutRefund).not.toHaveBeenCalled();
  });
});
