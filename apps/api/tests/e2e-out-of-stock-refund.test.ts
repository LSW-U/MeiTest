/**
 * e2e: 缺货自动退款引擎全链路（缺货履约闭环批3 2026-10-24，任务书 A3 场景1）
 *
 * 场景1 整单全缺 → system 自动退款直退到账：
 *   客户下单（WECHAT 预付）→ admin confirm（CONFIRMED 窗口）→ 全缺登记（单项订单整项缺）
 *   → 引擎触发：新建 OUT_OF_STOCK system 退款 → 直退 COMPLETED（≤$50 上限）
 *   → 客户退款列表可见 COMPLETED + reviewedBy='SYSTEM'
 *   → 异议链：POST dispute → 回 PENDING（人工复审）+ disputedAt 留痕
 *
 * 运行方式：docker compose up + API dev server → pnpm --filter @meimart/api test:e2e
 */
import { describe, it, expect } from 'vitest';
import { describeWhenApiUp } from './helpers/e2e-guard';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';

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

describeWhenApiUp('e2e: 缺货自动退款（批3 A3 场景1 全缺直退 + 异议）', () => {
  let customerToken: string;
  let adminToken: string;
  let skuId: string;
  let productId: string;
  let orderId: string;
  let itemId: string;
  let refundId: string;

  it('准备：登录 + 拿 SKU + 下单 WECHAT + mock 支付 → CONFIRMED', async () => {
    customerToken = await mockLogin('CUSTOMER', 'client_app');
    adminToken = await mockLogin('SUPER_ADMIN', 'admin_web');

    const products = await apiCall('/admin/products?limit=1', adminToken);
    productId = products.data[0].id;
    const detail = await apiCall(`/admin/products/${productId}`, adminToken);
    skuId = detail.data?.skus?.[0]?.id ?? '';
    if (!skuId) throw new Error('No SKU found');

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
    expect(orderRes.success).toBe(true);
    orderId = orderRes.data.id;

    const cbRes = await apiCall(`/client/payments/${orderId}/mock-callback`, customerToken, {
      method: 'POST',
    });
    expect(cbRes.success).toBe(true);

    const detailOrder = await apiCall(`/client/orders/${orderId}`, customerToken);
    expect(detailOrder.data.status).toBe('CONFIRMED');
    expect(detailOrder.data.paymentStatus).toBe('PAID');
    itemId = detailOrder.data.items[0].id;
  });

  it('全缺登记 → 订单 CANCELLED + system 自动退款直退 COMPLETED（reviewedBy=SYSTEM）', async () => {
    // 单项订单整项缺 → 全缺判定 D11 → CANCELLED → 引擎直退（≤$50）
    const reportRes = await apiCall(
      `/admin/orders/${orderId}/items/${itemId}/out-of-stock`,
      adminToken,
      {
        method: 'POST',
        body: JSON.stringify({ outOfStockQty: 1, reason: 'DAMAGED' }),
      },
    );
    expect(reportRes.success).toBe(true);
    expect(reportRes.data.orderCancelled).toBe(true);

    // 订单已取消
    const orderAfter = await apiCall(`/client/orders/${orderId}`, customerToken);
    expect(orderAfter.data.status).toBe('CANCELLED');

    // system 自动退款已落库（同步直推链路——登记返回即退款已建）
    const refunds = await apiCall('/client/refunds', customerToken);
    const oosRefund = refunds.data.find(
      (r: { orderId: string; reason: string }) => r.orderId === orderId && r.reason === 'OUT_OF_STOCK',
    );
    expect(oosRefund).toBeDefined();
    expect(oosRefund.status).toBe('COMPLETED');
    expect(oosRefund.reviewedBy).toBe('SYSTEM');
    expect(oosRefund.transactionId).toContain('MOCK_REFUND_');
    refundId = oosRefund.id;
  });

  it('异议链：COMPLETED system 退款 dispute → 只留痕（status 保持 COMPLETED + disputedAt 留痕）', async () => {
    const disputeRes = await apiCall(`/client/refunds/${refundId}/dispute`, customerToken, {
      method: 'POST',
      body: JSON.stringify({ note: 'e2e: 商品实际已收到，不同意退款' }),
    });
    expect(disputeRes.success).toBe(true);
    // P1-1 修复后语义：dispute 只留痕不动单——原单保持 COMPLETED（复审分流在 review 端点）
    expect(disputeRes.data.status).toBe('COMPLETED');
    expect(disputeRes.data.disputedAt).toBeTruthy();
    expect(disputeRes.data.disputeNote).toContain('e2e');

    // 二次异议 → E-OOS-006（一单一次）
    const second = await apiCall(`/client/refunds/${refundId}/dispute`, customerToken, {
      method: 'POST',
      body: JSON.stringify({ note: 'again' }),
    });
    expect(second.success).toBe(false);
    expect(second.error?.code).toBe('E-OOS-006');
  });

  it('复审 APPROVE（复审成立）→ 新建人工 PENDING 退款单，原单终态仍 COMPLETED + 无第二次销量回滚/Settlement', async () => {
    // 复审前快照：原单销量已回滚一次（COMPLETED 直退时），记录商品 salesCount 基线
    const productBefore = await apiCall(`/admin/products/${productId}`, adminToken);
    const salesBefore = productBefore.data?.salesCount ?? -1;

    const approveRes = await apiCall(`/admin/refunds/${refundId}/review`, adminToken, {
      method: 'POST',
      body: JSON.stringify({ action: 'APPROVE', reviewNote: 'e2e: 复审成立维持异议' }),
    });
    expect(approveRes.success).toBe(true);
    // 返回的是新建的人工 PENDING 退款单
    const newRefund = approveRes.data;
    expect(newRefund.id).not.toBe(refundId);
    expect(newRefund.status).toBe('PENDING');
    expect(newRefund.reasonDetail).toContain(`DISPUTE_REVIEW_OF:${refundId}`);

    // 原单保持 COMPLETED 不动
    const original = await apiCall(`/admin/refunds/${refundId}`, adminToken);
    expect(original.data.status).toBe('COMPLETED');
    expect(original.data.disputeNote).toContain('[DISPUTE_APPROVE]');

    // 🔴 无第二次销量回滚：salesCount 与复审前一致（若走 completeRefundTx 会再减一次）
    const productAfter = await apiCall(`/admin/products/${productId}`, adminToken);
    expect(productAfter.data?.salesCount ?? -1).toBe(salesBefore);

    // 🔴 无第二次 Settlement 负向行：COMPLETED OUT_OF_STOCK 退款仍只有原单 1 笔
    const refunds = await apiCall(`/admin/refunds?orderId=${orderId}`, adminToken);
    const completedOos = refunds.data.items.filter(
      (r: { status: string; reason: string }) => r.status === 'COMPLETED' && r.reason === 'OUT_OF_STOCK',
    );
    expect(completedOos.length).toBe(1);

    // 清理：驳回新建单避免影响其他场景（走 REJECT 需 reviewNote）
    await apiCall(`/admin/refunds/${newRefund.id}/review`, adminToken, {
      method: 'POST',
      body: JSON.stringify({ action: 'REJECT', reviewNote: 'e2e cleanup: 撤销复审新单' }),
    });
  });

  it('复审 REJECT（复审驳回）→ 原单终态保持 COMPLETED，仅 disputeNote 追加复审结论', async () => {
    // 前一场景 dispute 已留痕（disputedAt 非空），直接走复审驳回
    const rejectRes = await apiCall(`/admin/refunds/${refundId}/review`, adminToken, {
      method: 'POST',
      body: JSON.stringify({ action: 'REJECT', reviewNote: 'e2e: 复审驳回，维持原退款' }),
    });
    expect(rejectRes.success).toBe(true);
    // 原单终态不变（钱已退/账已动，不翻 REJECTED）
    expect(rejectRes.data.id).toBe(refundId);
    expect(rejectRes.data.status).toBe('COMPLETED');
    expect(rejectRes.data.disputeNote).toContain('[DISPUTE_REJECT]');
  });
});
