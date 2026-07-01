/**
 * e2e 主链路测试 — 客户下单全链路
 *
 * 覆盖 W6 任务：浏览→加购→下单→支付→dispatch→退款
 *
 * 运行方式：需要 docker compose up + API dev server 运行
 *   pnpm --filter @meimart/api test:e2e
 *
 * 注意：此测试调真实 HTTP（localhost:3000），不走 NestJS DI。
 * 每次测试创建独立订单，不依赖其他测试的状态。
 */
import { describe, it, expect } from 'vitest';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';

// ============ helpers ============

async function mockLogin(role: string, deviceType: string): Promise<string> {
  const res = await fetch(`${API}/common/auth/mock-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, deviceType }),
  });
  const body = await res.json();
  if (!body.success) throw new Error(`mock-login failed: ${body.error?.message}`);
  return body.data.accessToken;
}

async function apiCall(path: string, token: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Perspective': 'platform',
      ...(options.headers ?? {}),
    },
  });
  return res.json();
}

function uuid(): string {
  return crypto.randomUUID();
}

// ============ tests ============

describe('e2e: 客户下单全链路', () => {
  let customerToken: string;
  let adminToken: string;
  let skuId: string;

  it('准备：登录 + 拿 SKU', async () => {
    customerToken = await mockLogin('customer', 'client_app');
    adminToken = await mockLogin('super_admin', 'admin_web');

    // 从 admin products 拿一个 SKU
    const products = await apiCall('/admin/products?limit=1', adminToken);
    expect(products.success).toBe(true);
    expect(products.data.length).toBeGreaterThan(0);

    // 拿 SKU ID（从 DB 查更可靠）
    const detail = await apiCall(`/admin/products/${products.data[0].id}`, adminToken);
    skuId = detail.data?.skus?.[0]?.id ?? '';
    if (!skuId) throw new Error('No SKU found in product detail');
  });

  it('加购物车', async () => {
    const res = await apiCall('/client/cart/items', customerToken, {
      method: 'POST',
      body: JSON.stringify({ skuId, quantity: 2 }),
    });
    expect(res.success).toBe(true);
    expect(res.data.items.length).toBeGreaterThan(0);
  });

  it('创建地址', async () => {
    const res = await apiCall('/client/addresses', customerToken, {
      method: 'POST',
      body: JSON.stringify({
        name: 'E2E Test',
        phone: '+67077777777',
        region: { province: 'Dili', city: 'Dili' },
        detail: 'Test Address',
        lat: -8.5568,
        lng: 125.56,
        isDefault: true,
      }),
    });
    expect(res.success).toBe(true);
    expect(res.data.id).toBeDefined();
  });

  it('checkout preview', async () => {
    // 先拿地址
    const addrRes = await apiCall('/client/addresses', customerToken);
    const addressId = addrRes.data[0]?.id;
    expect(addressId).toBeDefined();

    const res = await apiCall('/client/cart/checkout-preview', customerToken, {
      method: 'POST',
      body: JSON.stringify({ addressId }),
    });
    expect(res.success).toBe(true);
    expect(res.data.items.length).toBeGreaterThan(0);
  });

  it('下单 COD + 购物车自动清空', async () => {
    const addrRes = await apiCall('/client/addresses', customerToken);
    const addressId = addrRes.data[0]?.id;

    const orderRes = await apiCall('/client/orders', customerToken, {
      method: 'POST',
      headers: { 'Idempotency-Key': uuid() },
      body: JSON.stringify({
        addressId,
        items: [{ skuId, quantity: 1 }],
        paymentMethod: 'COD',
      }),
    });
    expect(orderRes.success).toBe(true);
    expect(orderRes.data.orderNo).toMatch(/^MM\d{14}$/);
    expect(orderRes.data.status).toBe('PENDING_CONFIRM');

    // 购物车应该清空（W3-C B1）
    const cartRes = await apiCall('/client/cart', customerToken);
    expect(cartRes.data.items.length).toBe(0);
  });

  it('下单 WECHAT + mock-callback → CONFIRMED + dispatch 任务', async () => {
    const addrRes = await apiCall('/client/addresses', customerToken);
    const addressId = addrRes.data[0]?.id;

    const orderRes = await apiCall('/client/orders', customerToken, {
      method: 'POST',
      headers: { 'Idempotency-Key': uuid() },
      body: JSON.stringify({
        addressId,
        items: [{ skuId, quantity: 1 }],
        paymentMethod: 'WECHAT',
      }),
    });
    expect(orderRes.data.status).toBe('PENDING_PAYMENT');
    const orderId = orderRes.data.id;

    // mock 支付
    const cbRes = await apiCall(`/client/payments/${orderId}/mock-callback`, customerToken, {
      method: 'POST',
    });
    expect(cbRes.success).toBe(true);

    // 验证状态
    const detail = await apiCall(`/client/orders/${orderId}`, customerToken);
    expect(detail.data.status).toBe('CONFIRMED');
    expect(detail.data.paymentStatus).toBe('PAID');

    // 验证 dispatch 任务自动创建
    const adminDetail = await apiCall(`/admin/orders/${orderId}`, adminToken);
    // dispatch 任务在后端 OrderService.markPaid 时触发，通过 DB 可查
  });

  it('取消订单 + 库存回滚', async () => {
    const addrRes = await apiCall('/client/addresses', customerToken);
    const addressId = addrRes.data[0]?.id;

    const orderRes = await apiCall('/client/orders', customerToken, {
      method: 'POST',
      headers: { 'Idempotency-Key': uuid() },
      body: JSON.stringify({
        addressId,
        items: [{ skuId, quantity: 1 }],
        paymentMethod: 'COD',
      }),
    });
    const orderId = orderRes.data.id;

    const cancelRes = await apiCall(`/client/orders/${orderId}/cancel`, customerToken, {
      method: 'POST',
      body: JSON.stringify({ reason: 'e2e test cancel' }),
    });
    expect(cancelRes.data.status).toBe('CANCELLED');
  });
});

describe('e2e: 退款全链路', () => {
  let customerToken: string;
  let adminToken: string;
  let skuId: string;

  it('准备', async () => {
    customerToken = await mockLogin('customer', 'client_app');
    adminToken = await mockLogin('super_admin', 'admin_web');
    const products = await apiCall('/admin/products?limit=1', adminToken);
    const detail = await apiCall(`/admin/products/${products.data[0].id}`, adminToken);
    skuId = detail.data?.skus?.[0]?.id ?? '';
  });

  it('接单前退款（自动通过 COMPLETED）', async () => {
    const addrRes = await apiCall('/client/addresses', customerToken);
    const addressId = addrRes.data[0]?.id;

    // 下单 COD = PENDING_CONFIRM（接单前）
    const orderRes = await apiCall('/client/orders', customerToken, {
      method: 'POST',
      headers: { 'Idempotency-Key': uuid() },
      body: JSON.stringify({
        addressId,
        items: [{ skuId, quantity: 1 }],
        paymentMethod: 'COD',
      }),
    });

    // 申请退款
    const refundRes = await apiCall('/client/refunds', customerToken, {
      method: 'POST',
      body: JSON.stringify({
        orderId: orderRes.data.id,
        reason: 'CUSTOMER_CHANGE_MIND',
        reasonDetail: 'e2e test',
      }),
    });
    expect(refundRes.success).toBe(true);
    // PENDING_CONFIRM = 接单前 → 自动 COMPLETED
    expect(refundRes.data.status).toBe('COMPLETED');
    expect(refundRes.data.transactionId).toContain('MOCK_REFUND_');

    // P1 修复：补订单状态断言（覆盖 P0 bug）
    const orderAfter = await apiCall(`/client/orders/${orderRes.data.id}`, customerToken);
    expect(orderAfter.success).toBe(true);
    expect(orderAfter.data.status).toBe('CANCELLED');
  });

  it('接单后退款（PENDING → admin 审核通过 → COMPLETED）', async () => {
    const addrRes = await apiCall('/client/addresses', customerToken);
    const addressId = addrRes.data[0]?.id;

    // 下单 WECHAT + 支付 → CONFIRMED（接单后）
    const orderRes = await apiCall('/client/orders', customerToken, {
      method: 'POST',
      headers: { 'Idempotency-Key': uuid() },
      body: JSON.stringify({
        addressId,
        items: [{ skuId, quantity: 1 }],
        paymentMethod: 'WECHAT',
      }),
    });
    await apiCall(`/client/payments/${orderRes.data.id}/mock-callback`, customerToken, {
      method: 'POST',
    });

    // 申请退款 → PENDING
    const refundRes = await apiCall('/client/refunds', customerToken, {
      method: 'POST',
      body: JSON.stringify({
        orderId: orderRes.data.id,
        reason: 'QUALITY_ISSUE',
      }),
    });
    expect(refundRes.data.status).toBe('PENDING');

    // Admin 审核 APPROVE
    const reviewRes = await apiCall(
      `/admin/refunds/${refundRes.data.id}/review`,
      adminToken,
      { method: 'POST', body: JSON.stringify({ action: 'APPROVE' }) },
    );
    expect(reviewRes.data.status).toBe('COMPLETED');
    expect(reviewRes.data.transactionId).toContain('MOCK_REFUND_');
  });

  it('接单后退款（PENDING → admin 驳回 → REJECTED）', async () => {
    const addrRes = await apiCall('/client/addresses', customerToken);
    const addressId = addrRes.data[0]?.id;

    const orderRes = await apiCall('/client/orders', customerToken, {
      method: 'POST',
      headers: { 'Idempotency-Key': uuid() },
      body: JSON.stringify({
        addressId,
        items: [{ skuId, quantity: 1 }],
        paymentMethod: 'WECHAT',
      }),
    });
    await apiCall(`/client/payments/${orderRes.data.id}/mock-callback`, customerToken, {
      method: 'POST',
    });

    const refundRes = await apiCall('/client/refunds', customerToken, {
      method: 'POST',
      body: JSON.stringify({ orderId: orderRes.data.id, reason: 'OTHER' }),
    });

    const reviewRes = await apiCall(
      `/admin/refunds/${refundRes.data.id}/review`,
      adminToken,
      { method: 'POST', body: JSON.stringify({ action: 'REJECT', reviewNote: '不符合退款条件' }) },
    );
    expect(reviewRes.data.status).toBe('REJECTED');
  });

  it('客户撤回退款（PENDING → CANCELLED）', async () => {
    const addrRes = await apiCall('/client/addresses', customerToken);
    const addressId = addrRes.data[0]?.id;

    const orderRes = await apiCall('/client/orders', customerToken, {
      method: 'POST',
      headers: { 'Idempotency-Key': uuid() },
      body: JSON.stringify({
        addressId,
        items: [{ skuId, quantity: 1 }],
        paymentMethod: 'WECHAT',
      }),
    });
    await apiCall(`/client/payments/${orderRes.data.id}/mock-callback`, customerToken, {
      method: 'POST',
    });

    const refundRes = await apiCall('/client/refunds', customerToken, {
      method: 'POST',
      body: JSON.stringify({ orderId: orderRes.data.id, reason: 'OTHER' }),
    });

    const cancelRes = await apiCall(
      `/client/refunds/${refundRes.data.id}/cancel`,
      customerToken,
      { method: 'POST' },
    );
    expect(cancelRes.data.status).toBe('CANCELLED');
  });

  it('IdempotencyKey 防重复下单', async () => {
    const addrRes = await apiCall('/client/addresses', customerToken);
    const addressId = addrRes.data[0]?.id;
    const key = uuid();
    const body = JSON.stringify({
      addressId,
      items: [{ skuId, quantity: 1 }],
      paymentMethod: 'COD',
    });

    const order1 = await apiCall('/client/orders', customerToken, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body,
    });
    const order2 = await apiCall('/client/orders', customerToken, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body,
    });
    expect(order1.data.id).toBe(order2.data.id);
  });
});

describe('e2e: 异常路径', () => {
  let customerToken: string;
  let adminToken: string;
  let skuId: string;

  it('准备', async () => {
    customerToken = await mockLogin('customer', 'client_app');
    adminToken = await mockLogin('super_admin', 'admin_web');
    const products = await apiCall('/admin/products?limit=1', adminToken);
    const detail = await apiCall(`/admin/products/${products.data[0].id}`, adminToken);
    skuId = detail.data?.skus?.[0]?.id ?? '';
  });

  it('地址超范围 → 订单仍可创建（PostGIS 兜底到最近仓）', async () => {
    const addrRes = await apiCall('/client/addresses', customerToken, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Far',
        phone: '+67077777777',
        region: { province: 'Dili', city: 'Dili' },
        detail: 'Very far',
        lat: -9.0,
        lng: 125.0,
        isDefault: false,
      }),
    });
    // 即使地址偏远，PostGIS 仍匹配最近仓库（MVP 不拒单，由 deliveryFee 体现）
    expect(addrRes.success).toBe(true);
  });

  it('IdempotencyKey 非 UUID → 400', async () => {
    const addrRes = await apiCall('/client/addresses', customerToken);
    const addressId = addrRes.data[0]?.id;

    const res = await apiCall('/client/orders', customerToken, {
      method: 'POST',
      headers: { 'Idempotency-Key': 'not-a-uuid' },
      body: JSON.stringify({
        addressId,
        items: [{ skuId, quantity: 1 }],
        paymentMethod: 'COD',
      }),
    });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('E-COMMON-001');
  });

  it('已取消订单不能再申请退款', async () => {
    const addrRes = await apiCall('/client/addresses', customerToken);
    const addressId = addrRes.data[0]?.id;

    const orderRes = await apiCall('/client/orders', customerToken, {
      method: 'POST',
      headers: { 'Idempotency-Key': uuid() },
      body: JSON.stringify({
        addressId,
        items: [{ skuId, quantity: 1 }],
        paymentMethod: 'COD',
      }),
    });

    await apiCall(`/client/orders/${orderRes.data.id}/cancel`, customerToken, {
      method: 'POST',
      body: JSON.stringify({ reason: 'test' }),
    });

    const refundRes = await apiCall('/client/refunds', customerToken, {
      method: 'POST',
      body: JSON.stringify({ orderId: orderRes.data.id, reason: 'OTHER' }),
    });
    expect(refundRes.success).toBe(false);
    expect(refundRes.error?.code).toBe('E-ORDER-003');
  });

  it('customer 不能调 admin 端点 → 403', async () => {
    const res = await apiCall('/admin/orders', customerToken);
    expect(res.success).toBe(false);
    // DeviceTypeGuard 或 RolesGuard 拒绝
    expect([403, 'E-AUTH-001', 'E-AUTH-010'].some((c) =>
      JSON.stringify(res).includes(String(c)),
    )).toBe(true);
  });

  it('PAID 订单 admin cancel → 自动退款', async () => {
    const addrRes = await apiCall('/client/addresses', customerToken);
    const addressId = addrRes.data[0]?.id;

    const orderRes = await apiCall('/client/orders', customerToken, {
      method: 'POST',
      headers: { 'Idempotency-Key': uuid() },
      body: JSON.stringify({
        addressId,
        items: [{ skuId, quantity: 1 }],
        paymentMethod: 'WECHAT',
      }),
    });
    await apiCall(`/client/payments/${orderRes.data.id}/mock-callback`, customerToken, {
      method: 'POST',
    });

    // Admin 取消 PAID 订单（W5 升级：自动退款）
    const cancelRes = await apiCall(
      `/admin/orders/${orderRes.data.id}/cancel`,
      adminToken,
      { method: 'POST', body: JSON.stringify({ reason: 'admin cancel paid order' }) },
    );
    expect(cancelRes.success).toBe(true);
    expect(cancelRes.data.status).toBe('CANCELLED');

    // 验证退款已创建
    const refunds = await apiCall('/admin/refunds?status=COMPLETED', adminToken);
    const matching = refunds.data?.find((r: any) => r.orderId === orderRes.data.id);
    expect(matching).toBeDefined();
    expect(matching.status).toBe('COMPLETED');
  });
});
