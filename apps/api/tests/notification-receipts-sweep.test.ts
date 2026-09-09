/**
 * 批N4：Expo getReceipts 批量延迟回执 单测（2026-09-10）
 *
 * 覆盖（任务书 N4 #6，4 项全做）：
 *   - ok → deliveredOk 校准观测（deliveredCount 口径不动，P3-1 不回退）
 *   - DeviceNotRegistered → failedInvalidToken + failedCount increment（只增不降）
 *   - stub 模式 sweep job no-op（不调 fetch 不写库，dev 无凭证可跑不崩）
 *   - 重复 ticket 幂等（Redis NX 已标记 → skippedProcessed，不重复计数）
 *   - 附加：>1000 ticket 分块（官方单请求 ≤1000）/ enqueueReceiptsSweep 入队参数
 *
 * mock 面：db / redis（shared/cache）/ logger / infrastructure（getPushProvider）/
 * 全局 fetch（expo-receipts 真函数走 fetch mock，连分块逻辑一起验）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb, mockRedis } = vi.hoisted(() => ({
  mockDb: {
    notificationBatch: { update: vi.fn() },
    deviceToken: { findMany: vi.fn(), updateMany: vi.fn() },
  },
  mockRedis: {
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));
vi.mock('../src/shared/cache', () => ({ redis: mockRedis }));
vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// getPushProvider mock（processor sweep 守卫读通道）
const mockGetPushProvider = vi.fn<() => 'expo' | 'stub'>();
vi.mock('../src/infrastructure', () => ({ getPushProvider: () => mockGetPushProvider() }));

// fetch mock（expo-receipts 真实现）
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { NotificationPushProcessor } from '../src/modules/notification/notification-push.processor';
import { processReceipts } from '../src/modules/notification/receipts-sweep.service';
import { fetchAllExpoReceipts, EXPO_RECEIPTS_CHUNK_SIZE } from '../src/modules/notification/expo-receipts';
import { enqueueReceiptsSweep, NOTIFICATION_RECEIPTS_DELAY_MS } from '../src/modules/notification/receipts-sweep.helper';
import { sendPushToUser } from '../src/modules/notification/send-push-to-user';
import type { ExpoPushReceipt } from '../src/modules/notification/expo-receipts';

/** 造 processor sweep job（最小 Job 形状，sweep 分支只读 data/attemptsMade） */
function mkSweepJob(batchId: string, ticketIds: string[]) {
  return {
    data: { batchId, ticketIds },
    attemptsMade: 0,
  } as Parameters<NotificationPushProcessor['process']>[0];
}

function okReceipt(): ExpoPushReceipt {
  return { status: 'ok' };
}
function errReceipt(error: string, message?: string): ExpoPushReceipt {
  return { status: 'error', message, details: { error } };
}

describe('批N4 receipts sweep — processReceipts 处置', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRedis.set.mockResolvedValue('1'); // SETNX 成功 = 首次处理
    mockRedis.del.mockResolvedValue(1);
    mockDb.notificationBatch.update.mockResolvedValue({});
  });

  it('ok → deliveredOk 计数，不写批次行（P3-1 deliveredCount 口径不回退）', async () => {
    const summary = await processReceipts(
      'batch-1',
      ['t-ok-1', 't-ok-2'],
      new Map([
        ['t-ok-1', okReceipt()],
        ['t-ok-2', okReceipt()],
      ]),
    );

    expect(summary.deliveredOk).toBe(2);
    expect(summary.failedInvalidToken).toBe(0);
    expect(summary.failedOther).toBe(0);
    // ok 回执不动批次计数（基数=站内信落行数，已由 processor 写入）
    expect(mockDb.notificationBatch.update).not.toHaveBeenCalled();
  });

  it('DeviceNotRegistered → failedInvalidToken + failedCount increment（只增不降）', async () => {
    const summary = await processReceipts(
      'batch-1',
      ['t-bad'],
      new Map([['t-bad', errReceipt('DeviceNotRegistered')]]),
    );

    expect(summary.failedInvalidToken).toBe(1);
    expect(mockDb.notificationBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: { failedCount: { increment: 1 } },
    });
  });

  it('NotRegistered（旧错误码）同样判 INVALID；其他 error 计 failedOther', async () => {
    const summary = await processReceipts(
      'batch-1',
      ['t-old', 't-other'],
      new Map([
        ['t-old', errReceipt('NotRegistered')],
        ['t-other', errReceipt('MessageTooBig', 'message too big')],
      ]),
    );

    expect(summary.failedInvalidToken).toBe(1);
    expect(summary.failedOther).toBe(1);
    // 两类失败合并一次 increment=2
    expect(mockDb.notificationBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: { failedCount: { increment: 2 } },
    });
  });

  it('重复 ticket（Redis NX 已标记）→ skippedProcessed，不重复计数', async () => {
    mockRedis.set.mockResolvedValue(null); // SETNX 失败 = 已处理过

    const summary = await processReceipts(
      'batch-1',
      ['t-dup', 't-dup-2'],
      new Map([
        ['t-dup', okReceipt()],
        ['t-dup-2', errReceipt('DeviceNotRegistered')],
      ]),
    );

    expect(summary.skippedProcessed).toBe(2);
    expect(summary.deliveredOk).toBe(0);
    expect(summary.failedInvalidToken).toBe(0);
    expect(mockDb.notificationBatch.update).not.toHaveBeenCalled();
  });

  it('Expo 未返回的 ticket → missing，回滚幂等标记（重试可重查）', async () => {
    const summary = await processReceipts(
      'batch-1',
      ['t-missing'],
      new Map(), // 回执映射为空
    );

    expect(summary.missing).toBe(1);
    expect(mockRedis.del).toHaveBeenCalledWith('notification:receipt:processed:batch-1:t-missing');
    expect(mockDb.notificationBatch.update).not.toHaveBeenCalled();
  });

  it('Redis SETNX 抛异常（审查 P3-1）→ 继续处置不静默跳过（error 日志 + 计数照写）', async () => {
    mockRedis.set.mockRejectedValue(new Error('redis down'));

    const summary = await processReceipts(
      'batch-1',
      ['t-err'],
      new Map([['t-err', errReceipt('DeviceNotRegistered')]]),
    );

    // 异常 ≠ 已处理：不进 skippedProcessed，处置继续
    expect(summary.skippedProcessed).toBe(0);
    expect(summary.failedInvalidToken).toBe(1);
    expect(mockDb.notificationBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: { failedCount: { increment: 1 } },
    });
  });
});

// ===== 批N4 审查 P2-1：sendPushToUser 消费 invalid: 标记 → token 置 INVALID =====
describe('批N4 审查 P2-1 — sendPushToUser invalid: 消费', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // sendPushToUser 先查 ACTIVE tokens（有 token 才走发送循环）
    mockDb.deviceToken.findMany.mockResolvedValue([
      { token: 'ExponentPushToken[dead]', locale: 'en' },
    ]);
    mockDb.deviceToken.updateMany.mockResolvedValue({ count: 1 });
  });

  function mkFactory(pushResult: Record<string, unknown>) {
    return {
      sendMulti: vi.fn().mockResolvedValue({ PUSH: pushResult }),
    };
  }

  const baseInput = (factory: unknown) => ({
    notifyFactory: factory,
    userId: 'user-1',
    type: 'SYSTEM',
    title: { en: 't' },
    content: { en: 'c' },
  });

  it('DeviceNotRegistered（invalid: 前缀 messageId）→ updateMany 置 INVALID + pushFailed=1', async () => {
    const factory = mkFactory({
      success: false,
      mockFlag: false,
      messageId: 'invalid:ExponentPushToken[dead]',
      error: 'DeviceNotRegistered',
    });

    const result = await sendPushToUser(baseInput(factory));

    expect(result.pushFailed).toBe(1);
    expect(result.pushError).toBe('DeviceNotRegistered');
    expect(mockDb.deviceToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', token: 'ExponentPushToken[dead]' },
      data: { status: 'INVALID' },
    });
  });

  it('普通失败（无 invalid: 标记）→ 不写 INVALID（避免误清活 token）', async () => {
    const factory = mkFactory({ success: false, mockFlag: false, error: 'EXPO_HTTP_500' });

    const result = await sendPushToUser(baseInput(factory));

    expect(result.pushFailed).toBe(1);
    expect(mockDb.deviceToken.updateMany).not.toHaveBeenCalled();
  });
});

describe('批N4 receipts sweep — processor job 分支 + 守卫', () => {
  let processor: NotificationPushProcessor;

  beforeEach(() => {
    vi.resetAllMocks();
    mockRedis.set.mockResolvedValue('1');
    mockDb.notificationBatch.update.mockResolvedValue({});
    processor = new NotificationPushProcessor(null, null);
  });

  it('stub 模式 → sweep job no-op：不调 fetch 不写库不崩（N4-c）', async () => {
    mockGetPushProvider.mockReturnValue('stub');

    await processor.process(mkSweepJob('batch-1', ['t-1', 't-2']));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockDb.notificationBatch.update).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('expo 模式 → 拉回执 + 处置走通（job 分支判别 receipts-sweep）', async () => {
    mockGetPushProvider.mockReturnValue('expo');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { 't-1': { status: 'ok' } } }), { status: 200 }),
    );

    await processor.process(mkSweepJob('batch-1', ['t-1']));

    // getReceipts 真调用：URL + body {ids}
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://exp.host/--/api/v2/push/getReceipts');
    expect(JSON.parse(init.body)).toEqual({ ids: ['t-1'] });
  });

  it('空 ticketIds → no-op（不调 fetch）', async () => {
    mockGetPushProvider.mockReturnValue('expo');

    await processor.process(mkSweepJob('batch-1', []));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('批N4 receipts sweep — 分块 + 入队', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('fetchAllExpoReceipts：>1000 ticket 分块请求（每块 ≤1000，合并映射）', async () => {
    const ids = Array.from({ length: EXPO_RECEIPTS_CHUNK_SIZE + 500 }, (_, i) => `t-${i}`);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { 't-0': { status: 'ok' } } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { [`t-${EXPO_RECEIPTS_CHUNK_SIZE}`]: { status: 'ok' } } }), { status: 200 }),
      );

    const merged = await fetchAllExpoReceipts(ids);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstIds = JSON.parse(fetchMock.mock.calls[0][1].body).ids as string[];
    const secondIds = JSON.parse(fetchMock.mock.calls[1][1].body).ids as string[];
    expect(firstIds).toHaveLength(EXPO_RECEIPTS_CHUNK_SIZE);
    expect(secondIds).toHaveLength(500);
    expect(merged.size).toBe(2);
    expect(merged.get('t-0')?.status).toBe('ok');
  });

  it('enqueueReceiptsSweep：delay 5min + attempts 3（N4-a 入队参数）', async () => {
    const add = vi.fn().mockResolvedValue({});
    const queue = { add } as unknown as Parameters<typeof enqueueReceiptsSweep>[0];

    await enqueueReceiptsSweep(queue, 'batch-1', ['t-1', 't-2']);

    expect(add).toHaveBeenCalledWith(
      'receipts-sweep',
      { batchId: 'batch-1', ticketIds: ['t-1', 't-2'] },
      expect.objectContaining({
        delay: NOTIFICATION_RECEIPTS_DELAY_MS,
        attempts: 3,
      }),
    );
    expect(NOTIFICATION_RECEIPTS_DELAY_MS).toBe(5 * 60 * 1000);
  });

  it('enqueueReceiptsSweep：queue=null（测试环境）/空 tickets → no-op', async () => {
    await expect(enqueueReceiptsSweep(null, 'batch-1', ['t-1'])).resolves.toBeUndefined();
    const add = vi.fn();
    const queue = { add } as unknown as Parameters<typeof enqueueReceiptsSweep>[0];
    await enqueueReceiptsSweep(queue, 'batch-1', []);
    expect(add).not.toHaveBeenCalled();
  });
});
