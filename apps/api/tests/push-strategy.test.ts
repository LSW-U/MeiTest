/**
 * PushNotifyStrategy 单测（批A A2，2026-09-09）
 *
 * 覆盖：
 *   - stub 默认通道（无 PUSH_PROVIDER）→ mockFlag=true
 *   - expo 通道：正常发送（fetch mock）/ HTTP 错误 / token 失效标记 / 无 token 拒发
 *   - expo 无凭证 dev 降级 stub
 *
 * env 操作：直接读写 process.env（vi.stubEnv 更稳，vitest 自带）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../src/shared/logger/logger', () => ({ logger: mockLogger }));

// fetch mock（全局）
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import {
  PushNotifyStrategy,
  EXPO_INVALID_TOKEN_ERRORS,
  clearPushProviderCache,
} from '../src/infrastructure/notify/push.strategy';

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    type: 'ORDER_STATUS' as const,
    title: { en: 'Hello', zh: '你好' },
    body: { en: 'World', zh: '世界' },
    locale: 'zh',
    ...overrides,
  };
}

describe('PushNotifyStrategy', () => {
  let strategy: PushNotifyStrategy;

  beforeEach(() => {
    vi.resetAllMocks();
    strategy = new PushNotifyStrategy();
    fetchMock.mockReset();
    delete process.env.PUSH_PROVIDER;
    delete process.env.EXPO_ACCESS_TOKEN;
    process.env.NODE_ENV = 'test';
    // 审查 P3-2：resolveProvider 模块级缓存——env 切换前必须清缓存
    clearPushProviderCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.PUSH_PROVIDER;
    delete process.env.EXPO_ACCESS_TOKEN;
  });

  it('默认（无 PUSH_PROVIDER）→ stub 通道：mockFlag=true，不调 fetch', async () => {
    const result = await strategy.send(baseRequest());

    expect(result.success).toBe(true);
    expect(result.mockFlag).toBe(true);
    expect(result.messageId).toMatch(/^mock_push_/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PUSH_PROVIDER=expo + 无凭证 + 非 production → 降级 stub（mockFlag=true）', async () => {
    process.env.PUSH_PROVIDER = 'expo';

    const result = await strategy.send(baseRequest());

    expect(result.mockFlag).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'PUSH_PROVIDER_EXPO_NO_TOKEN' }),
    );
  });

  it('PUSH_PROVIDER=expo + 凭证 → 真 Expo 调用：POST 分块单条 + Bearer 头 + 成功返回 messageId', async () => {
    process.env.PUSH_PROVIDER = 'expo';
    process.env.EXPO_ACCESS_TOKEN = 'expo-token-xyz';
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ status: 'ok', id: 'expo-msg-9' }] }), { status: 200 }),
    );

    const result = await strategy.send(
      baseRequest({ data: { token: 'ExponentPushToken[abc]' } }),
    );

    expect(result.success).toBe(true);
    expect(result.mockFlag).toBe(false);
    expect(result.messageId).toBe('expo-msg-9');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(init.headers.Authorization).toBe('Bearer expo-token-xyz');
    const payload = JSON.parse(init.body);
    expect(payload).toHaveLength(1);
    expect(payload[0].to).toBe('ExponentPushToken[abc]');
    expect(payload[0].title).toBe('你好'); // locale=zh pick
  });

  it('expo 通道 + data 无 token → success=false MISSING_DEVICE_TOKEN，不发请求', async () => {
    process.env.PUSH_PROVIDER = 'expo';
    process.env.EXPO_ACCESS_TOKEN = 'tok';

    const result = await strategy.send(baseRequest());

    expect(result.success).toBe(false);
    expect(result.error).toBe('MISSING_DEVICE_TOKEN');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('expo 通道 + HTTP 500 → success=false EXPO_HTTP_500（不抛错）', async () => {
    process.env.PUSH_PROVIDER = 'expo';
    process.env.EXPO_ACCESS_TOKEN = 'tok';
    fetchMock.mockResolvedValueOnce(new Response('server error', { status: 500 }));

    const result = await strategy.send(baseRequest({ data: { token: 'tok-1' } }));

    expect(result.success).toBe(false);
    expect(result.error).toBe('EXPO_HTTP_500');
  });

  it('expo 通道 + 网络异常 → success=false + error 透传（通知失败容忍，不抛）', async () => {
    process.env.PUSH_PROVIDER = 'expo';
    process.env.EXPO_ACCESS_TOKEN = 'tok';
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const result = await strategy.send(baseRequest({ data: { token: 'tok-1' } }));

    expect(result.success).toBe(false);
    expect(result.error).toBe('network down');
  });

  it('expo 无凭证群发：resolveProvider 缓存生效，多次 send 只 warn 一次（审查 P3-2）', async () => {
    process.env.PUSH_PROVIDER = 'expo';

    await strategy.send(baseRequest());
    await strategy.send(baseRequest());
    await strategy.send(baseRequest());

    const warns = mockLogger.warn.mock.calls.filter(
      (c) => (c[0] as { msg?: string }).msg === 'PUSH_PROVIDER_EXPO_NO_TOKEN',
    );
    expect(warns).toHaveLength(1);
  });

  it('expo 回执 error=NotRegistered → messageId=invalid:<token>（调用方置 INVALID 的标记）', async () => {
    process.env.PUSH_PROVIDER = 'expo';
    process.env.EXPO_ACCESS_TOKEN = 'tok';
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ status: 'error', message: 'not registered', details: { error: 'NotRegistered' } }],
        }),
        { status: 200 },
      ),
    );

    const result = await strategy.send(baseRequest({ data: { token: 'dead-token' } }));

    expect(result.success).toBe(false);
    expect(result.messageId).toBe('invalid:dead-token');
    expect(result.error).toBe('NotRegistered');
    expect(EXPO_INVALID_TOKEN_ERRORS.has('DeviceNotRegistered')).toBe(true);
  });

  it('expo 回执 error 非 token 失效（如 MessageTooBig）→ 普通失败，无 invalid 标记', async () => {
    process.env.PUSH_PROVIDER = 'expo';
    process.env.EXPO_ACCESS_TOKEN = 'tok';
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ status: 'error', message: 'too big', details: { error: 'MessageTooBig' } }],
        }),
        { status: 200 },
      ),
    );

    const result = await strategy.send(baseRequest({ data: { token: 'tok-1' } }));

    expect(result.success).toBe(false);
    expect(result.error).toBe('MessageTooBig');
    expect(result.messageId).toBeUndefined();
  });
});
