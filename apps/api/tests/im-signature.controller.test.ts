/**
 * ImSignatureController 单测（流程 M W3）
 *
 * 覆盖场景：
 *   1. signature：返回 ImSignature 完整结构（url/namespace/events/conversationFormats）
 *   2. 优先用 WS_URL 环境变量
 *   3. 退化用请求 host 推断（http→ws, https→wss）
 *   4. 兜底 ws://localhost:3001
 *   5. userId / role 从 JWT user 取
 *
 * 决策依据：W-M-C-T 任务 §W3 M1 C1 "用户签名接口（后端薄壳）"
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ImSignatureController } from '../src/modules/im/im-signature.controller';
import type { RequestUser } from '../src/modules/auth/strategies/jwt.strategy';
import type { Request as ExpressRequest } from 'express';

function makeReq(
  user: RequestUser,
  overrides: Partial<ExpressRequest> = {},
): ExpressRequest & { user: RequestUser } {
  return {
    ...({
      protocol: 'http',
      get: () => 'api.example.com',
    } as unknown as ExpressRequest),
    ...overrides,
    user,
  } as ExpressRequest & { user: RequestUser };
}

describe('ImSignatureController', () => {
  let controller: ImSignatureController;

  beforeEach(() => {
    controller = new ImSignatureController();
    delete process.env.WS_URL;
  });

  it('返回完整 ImSignature 结构', () => {
    const req = makeReq({
      sub: 'c-1',
      role: 'customer',
      deviceType: 'client_app',
    });

    const result = controller.signature(req);

    expect(result.success).toBe(true);
    const data = result.data;
    expect(data.namespace).toBe('/realtime');
    expect(data.transport).toBe('websocket');
    expect(data.authScheme).toBe('bearer');
    expect(data.userId).toBe('c-1');
    expect(data.role).toBe('customer');
    expect(data.serverEvents).toContain('im:message');
    expect(data.clientEvents).toEqual(
      expect.arrayContaining(['im:join', 'im:leave', 'im:send', 'im:read']),
    );
    expect(data.conversationFormats.customerMerchant.template).toBe('conv:cm:{customerId}:{shopId}');
    expect(data.conversationFormats.customerRider.template).toBe(
      'conv:cr:{customerId}:{riderId}:{orderId}',
    );
    expect(data.conversationFormats.customerService.template).toBe(
      'conv:cs:{customerId}:{csId}',
    );
    expect(data.messageRetentionDays).toBe(7);
    expect(data.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('优先用 WS_URL 环境变量', () => {
    process.env.WS_URL = 'wss://ws.custom.example.com';
    const req = makeReq({
      sub: 'r-1',
      role: 'rider',
      deviceType: 'rider_app',
    });

    const result = controller.signature(req);
    expect(result.data.url).toBe('wss://ws.custom.example.com');
  });

  it('退化用 host 推断（http → ws）', () => {
    const req = makeReq(
      {
        sub: 'a-1',
        role: 'super_admin',
        deviceType: 'admin_web',
      },
      {
        protocol: 'http',
        get: () => 'api.example.com',
      } as unknown as ExpressRequest,
    );

    const result = controller.signature(req);
    expect(result.data.url).toBe('ws://api.example.com');
  });

  it('退化用 host 推断（https → wss）', () => {
    const req = makeReq(
      {
        sub: 'a-1',
        role: 'super_admin',
        deviceType: 'admin_web',
      },
      {
        protocol: 'https',
        get: () => 'api.example.com',
      } as unknown as ExpressRequest,
    );

    const result = controller.signature(req);
    expect(result.data.url).toBe('wss://api.example.com');
  });

  it('无 host 时兜底 ws://localhost:3001', () => {
    const req = makeReq(
      {
        sub: 'a-1',
        role: 'super_admin',
        deviceType: 'admin_web',
      },
      {
        protocol: 'http',
        get: () => undefined,
      } as unknown as ExpressRequest,
    );

    const result = controller.signature(req);
    expect(result.data.url).toBe('ws://localhost:3001');
  });

  it('不同角色（customer_service）通过', () => {
    const req = makeReq({
      sub: 'cs-1',
      role: 'customer_service',
      deviceType: 'admin_web',
    });

    const result = controller.signature(req);
    expect(result.data.role).toBe('customer_service');
  });
});
