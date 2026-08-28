/**
 * e2e 后台通知推送（admin-web 优化方案 批次2 2026-08-29）
 *
 * 验证 admin 发送 + 历史 + 客户端拉取 端到端：
 *   1. customer 登录（拿其 userId）
 *   2. admin POST /admin/notifications（target=SPECIFIC_USERS + userIds）→ deliveredCount≥1，push.mockFlag=true
 *   3. admin GET /admin/notifications 历史能见到该通知
 *   4. customer GET /client/notifications 能拉到该通知（真链路写表生效）
 *   5. admin POST target=SPECIFIC_USERS + 不存在 userIds → 400 E-ADMIN-NOTIF-001
 *   6. admin POST target=SPECIFIC_USERS 空 userIds（绕过 refine 直送）→ 400（zod 或 service 双保险）
 *   7. ALL_CUSTOMERS 群发（P2-2）：mock-login ≥2 customer → admin POST target=ALL_CUSTOMERS
 *      → 两个 customer 都 GET /client/notifications 拉到 → deliveredCount≥2（真链路群发写表生效）
 *
 * 运行方式：需要 docker compose up + API dev server 运行
 *   pnpm --filter @meimart/api test:e2e tests/e2e-admin-notification.test.ts
 *
 * 注意：真 HTTP（localhost:3000），不走 NestJS DI。
 */
import { describe, it, expect } from 'vitest';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';

// ============ helpers ============

async function mockLogin(role: string, deviceType: string, userId?: string): Promise<string> {
  const res = await fetch(`${API}/common/auth/mock-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, deviceType, ...(userId ? { userId } : {}) }),
  });
  const body = await res.json();
  if (!body.success) throw new Error(`mock-login failed: ${body.error?.message}`);
  return body.data.accessToken;
}

async function apiCall(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Perspective': 'platform',
      ...(options.headers ?? {}),
    },
  });
  return { status: res.status, body: await res.json() };
}

function uuid(): string {
  return crypto.randomUUID();
}

const TITLE = { en: `e2e-notif-${uuid().slice(0, 8)}`, zh: '', id: '', pt: '' };
const CONTENT = { en: 'e2e body', zh: '', id: '', pt: '' };

// ============ tests ============

describe('e2e: 后台通知推送', () => {
  let customerToken: string;
  let customerUserId: string;
  let adminToken: string;
  let createdNotificationId: string;

  it('准备：customer 登录 + 拿 userId + admin 登录', async () => {
    // mock-login 不传 userId 默认返 seed super_admin user（跨 role 共用同一 user 行），
    // 这里显式用 seed customer (+67077777778) 以拿到真实 CUSTOMER 身份。
    customerToken = await mockLogin('CUSTOMER', 'client_app', '68530da1-3e8c-4d1b-8e40-ad74428985e4');
    adminToken = await mockLogin('SUPER_ADMIN', 'admin_web');

    const { body } = await apiCall('/client/user/profile', customerToken);
    expect(body.success).toBe(true);
    customerUserId = body.data.id;
    expect(customerUserId).toBe('68530da1-3e8c-4d1b-8e40-ad74428985e4');
  });

  it('admin POST /admin/notifications（SPECIFIC_USERS）→ deliveredCount≥1，push.mockFlag=true', async () => {
    const { status, body } = await apiCall('/admin/notifications', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        target: 'SPECIFIC_USERS',
        userIds: [customerUserId],
        type: 'SYSTEM',
        title: TITLE,
        content: CONTENT,
        data: null,
      }),
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.deliveredCount).toBeGreaterThanOrEqual(1);
    expect(body.data.push).toBeTruthy();
    expect(body.data.push.mockFlag).toBe(true);
  });

  it('customer GET /client/notifications 能拉到该通知（真链路写表生效）', async () => {
    const { status, body } = await apiCall('/client/notifications', customerToken);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const found = (body.data as any[]).find(
      (n) => n.title?.en === TITLE.en,
    );
    expect(found).toBeTruthy();
    expect(found.content?.en).toBe(CONTENT.en);
    expect(found.isRead).toBe(false);
    createdNotificationId = found.id;
  });

  it('admin GET /admin/notifications 历史能见到该通知', async () => {
    const { status, body } = await apiCall('/admin/notifications', adminToken);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const found = body.data.items.find((it: any) => it.title?.en === TITLE.en);
    expect(found).toBeTruthy();
    expect(found.type).toBe('SYSTEM');
  });

  it('admin POST target=SPECIFIC_USERS + 存在但格式合法的 userId 仍校验不存在 → 400 E-ADMIN-NOTIF-001', async () => {
    // userIds 经 zod Id(uuid) 校验通过 → 进 service，service 查 DB 不存在抛 E-ADMIN-NOTIF-001
    const fakeButValidUuid = '00000000-0000-4000-8000-000000000000';
    const { status, body } = await apiCall('/admin/notifications', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        target: 'SPECIFIC_USERS',
        userIds: [fakeButValidUuid],
        type: 'SYSTEM',
        title: { en: 'x', zh: '', id: '', pt: '' },
        content: { en: 'y', zh: '', id: '', pt: '' },
        data: null,
      }),
    });
    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('E-ADMIN-NOTIF-001');
  });

  it('admin POST target=SPECIFIC_USERS 无 userIds → 400（zod refine 拦）', async () => {
    const { status, body } = await apiCall('/admin/notifications', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        target: 'SPECIFIC_USERS',
        type: 'SYSTEM',
        title: { en: 'x', zh: '', id: '', pt: '' },
        content: { en: 'y', zh: '', id: '', pt: '' },
        data: null,
      }),
    });
    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  // ===== P2-2（2026-08-29）：ALL_CUSTOMERS 群发分支 e2e 真链路覆盖 =====
  // e2e 造不了 50001 用户验 E-ADMIN-NOTIF-002，那部分由 admin-notification.service.test.ts 单测覆盖；
  // 这里覆盖 ALL_CUSTOMERS 群发写表真链路：≥2 customer 都拉到通知 + deliveredCount≥2。

  describe('P2-2: ALL_CUSTOMERS 群发真链路', () => {
    const BC_TITLE = { en: `e2e-bc-${uuid().slice(0, 8)}`, zh: '', id: '', pt: '' };
    const BC_CONTENT = { en: 'e2e broadcast body', zh: '', id: '', pt: '' };
    let customer2Token: string;
    let customer2UserId: string;

    it('准备：第二个 customer 登录 + 拿 userId（用显式 userId 避免与默认 seed customer 撞）', async () => {
      // mock-login 默认返 seed super_admin user（跨 role 共用），CUSTOMER 不指定 userId 时同返该 user，
      // 无法验「两个不同 customer 都收到群发」。这里用显式 userId 指向不同的真实 customer。
      // 68530da1... = seed customer (+67077777778)；de6dc362... = 另一个 seed customer (+67088888888)。
      customer2Token = await mockLogin('CUSTOMER', 'client_app', 'de6dc362-8f63-404a-a935-88f2c37a33f6');
      const { body } = await apiCall('/client/user/profile', customer2Token);
      expect(body.success).toBe(true);
      customer2UserId = body.data.id;
      expect(customer2UserId).toBe('de6dc362-8f63-404a-a935-88f2c37a33f6');
    });

    it('admin POST target=ALL_CUSTOMERS → deliveredCount≥2，push.mockFlag=true', async () => {
      const { status, body } = await apiCall('/admin/notifications', adminToken, {
        method: 'POST',
        body: JSON.stringify({
          target: 'ALL_CUSTOMERS',
          type: 'PROMOTION',
          title: BC_TITLE,
          content: BC_CONTENT,
          data: null,
        }),
      });
      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.deliveredCount).toBeGreaterThanOrEqual(2);
      expect(body.data.push).toBeTruthy();
      expect(body.data.push.mockFlag).toBe(true);
    });

    it('customer1 GET /client/notifications 拉到群发通知（真链路写表生效）', async () => {
      const { status, body } = await apiCall('/client/notifications', customerToken);
      expect(status).toBe(200);
      const found = (body.data as any[]).find((n) => n.title?.en === BC_TITLE.en);
      expect(found).toBeTruthy();
      expect(found.type).toBe('PROMOTION');
    });

    it('customer2 GET /client/notifications 拉到同一条群发通知（全员投递验证）', async () => {
      const { status, body } = await apiCall('/client/notifications', customer2Token);
      expect(status).toBe(200);
      const found = (body.data as any[]).find((n) => n.title?.en === BC_TITLE.en);
      expect(found).toBeTruthy();
      expect(found.type).toBe('PROMOTION');
    });
  });
});
