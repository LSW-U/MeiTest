/**
 * e2e 后台反馈管理（admin-web 优化方案 批次2 2026-08-29）
 *
 * 验证 admin 只读链路端到端：
 *   1. customer 登录 → POST /client/feedback 提交一条反馈
 *   2. admin 登录 → GET /admin/feedback 列表能见到该反馈（含 submitter 摘要）
 *   3. admin GET /admin/feedback/:id 详情含 images + submitter 扩展（email/role/status）
 *   4. admin GET /admin/feedback/:missing → 404 E-FEEDBACK-002
 *   5. admin GET /admin/feedback?category=bug 筛选生效（提交的 category 不命中 → 列表无该条）
 *
 * P3-3 限流 flaky 修复（2026-08-29）：
 *   feedback 提交端点限流 key=feedback:user:${user.sub}（5 次/小时）。
 *   旧实现用固定 seed customer → 1 小时内重复跑 e2e 会 429 挂 4 个用例（已实测复现）。
 *   现每次跑用「随机手机号注册新 CUSTOMER」拿独立 user.sub → 独立限流桶 → 永不撞限流。
 *   （同 notification e2e 显式 userId 的隔离思路，但这里用真实注册拿全新 sub。）
 *
 *   连带限流面：register/complete 走 register:ip:${ip}:1h（5 次/小时）。
 *   新注册引入了这条限流，1 小时内重跑 e2e 仍会 429（已实测复现）。
 *   beforeAll 直连 Redis DEL 清掉本机 IP 的 register:ip 桶，让 e2e 可短时间连续重跑。
 *   （仅 dev/staging 测试用，prod 无此豁免；Redis 容器名 meimart-redis 与 docker-compose 一致。）
 *
 * 运行方式：需要 docker compose up + API dev server 运行
 *   pnpm --filter @meimart/api test:e2e tests/e2e-admin-feedback.test.ts
 *
 * 注意：真 HTTP（localhost:3000），不走 NestJS DI。
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';

/**
 * 清掉本机 IP 的 register:ip:${ip}:1h 限流桶（5 次/小时）。
 *
 * registerFreshCustomer 每次注册都走 register/complete 端点，触发 register:ip:${ip}:1h 计数。
 * 1 小时内重跑 e2e 会因这 5 次配额耗尽而 429（实测复现），拖垮全部用例。
 * beforeAll 直连 Redis DEL 清桶，让 e2e 可短时间连续重跑。
 *
 * dev/staging 仅 Redis 容器名 meimart-redis（docker-compose 服务名 redis）。
 * 无 Redis / 容器不可达时静默跳过（不影响 e2e 首次跑；连续重跑才需此豁免）。
 */
async function clearRegisterIpLimit(): Promise<void> {
  const REDIS = process.env.REDIS_URL ?? 'redis://localhost:6379';
  // rate-limit key 形如 ratelimit:register:ip:<ip>:1h（IP 在 dev 走 ::1 / 127.0.0.1，匹配前缀即可）
  // 批F收尾 P2-1（2026-09-03）：key 实际带 meimart: namespace 前缀（ratelimit.guard 统一前缀），
  // 原 pattern 缺前缀恒不命中 → e2e 重跑自污染复现。prefix * 兜住 namespace。
  const pattern = '*ratelimit:register:ip:*:1h*';
  try {
    // 用 docker exec 进入 redis 容器清 key（不依赖测试进程装 ioredis）
    const { execSync } = await import('node:child_process');
    const container = process.env.REDIS_CONTAINER ?? 'meimart-redis';
    // 先 SCAN 出匹配 key，再逐个 DEL
    const keysOut = execSync(
      `docker exec ${container} redis-cli --scan --pattern '${pattern}' 2>/dev/null`,
      { stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString().trim();
    if (!keysOut) return;
    for (const key of keysOut.split('\n').filter(Boolean)) {
      execSync(`docker exec ${container} redis-cli del '${key}' 2>/dev/null`, {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    }
    void REDIS; // REDIS_URL 仅作记录，清理走 docker exec（避免测试进程 ioredis 依赖）
  } catch {
    // Redis 容器不可达（如未起 docker compose）→ 静默跳过，e2e 首次跑不依赖此清理
  }
}

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

/**
 * 注册一个全新 CUSTOMER（随机手机号），返回 accessToken + userId。
 *
 * 用途：feedback 提交限流 key=feedback:user:${user.sub}（5 次/小时），
 *   固定 seed customer 1 小时内重跑 e2e 必 429。每次跑用新手机号注册 → 独立 sub → 独立桶。
 *   流程：sms/send（dev stub 固定 123456）→ sms/verify 拿 registrationTicket → register/complete 拿 token。
 */
async function registerFreshCustomer(): Promise<{ token: string; userId: string }> {
  // 随机手机号：+670 + 7 位随机（避开 seed 号段 77777778/88888888/99999999）
  const phone = `+670${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

  const sendRes = await fetch(`${API}/common/auth/sms/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  const sendBody = await sendRes.json();
  if (!sendBody.success) throw new Error(`sms/send failed: ${sendBody.error?.message}`);
  const challengeId = sendBody.data.challengeId;

  const verifyRes = await fetch(`${API}/common/auth/sms/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code: '123456', challengeId }),
  });
  const verifyBody = await verifyRes.json();
  if (!verifyBody.success) throw new Error(`sms/verify failed: ${verifyBody.error?.message}`);
  const registrationTicket = verifyBody.data.registrationTicket;
  if (!registrationTicket) {
    // 手机号已注册 → 走 LOGIN 分支无 ticket。理论极低概率（随机号段），兜底换号重试一次。
    return registerFreshCustomer();
  }

  const completeRes = await fetch(`${API}/common/auth/register/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ registrationTicket, agreedToTerms: true, challengeId }),
  });
  const completeBody = await completeRes.json();
  if (!completeBody.success) throw new Error(`register/complete failed: ${completeBody.error?.message}`);

  return {
    token: completeBody.data.accessToken,
    userId: completeBody.data.user.id,
  };
}

// ============ tests ============

describe('e2e: 后台反馈管理（admin 只读）', () => {
  let customerToken: string;
  let adminToken: string;
  let feedbackId: string;
  const content = `e2e-feedback-${uuid().slice(0, 8)} 内容至少十个字符以上以确保通过 zod 校验`;
  const contact = 'whatsapp:+62881234';

  // 清掉 register:ip 限流桶，让 registerFreshCustomer 可短时间连续重跑（P3-3 连带限流面）
  beforeAll(async () => {
    await clearRegisterIpLimit();
  });

  it('准备：注册全新 customer（独立限流桶）+ 提交一条反馈 + admin 登录', async () => {
    // 每次跑注册新 CUSTOMER → 独立 feedback:user:<sub> 桶，1 小时内重跑不再 429
    const fresh = await registerFreshCustomer();
    customerToken = fresh.token;
    adminToken = await mockLogin('SUPER_ADMIN', 'admin_web');

    const { status, body } = await apiCall('/client/feedback', customerToken, {
      method: 'POST',
      body: JSON.stringify({
        category: 'feature',
        content,
        contact,
        images: [],
      }),
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBeTruthy();
    feedbackId = body.data.id;
  });

  it('admin GET /admin/feedback 列表能见到该反馈（含 submitter 摘要）', async () => {
    const { status, body } = await apiCall(
      `/admin/feedback?keyword=${encodeURIComponent(content.slice(0, 16))}`,
      adminToken,
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.items.length).toBeGreaterThan(0);
    const item = body.data.items.find((it: any) => it.id === feedbackId);
    expect(item).toBeTruthy();
    expect(item.content).toBe(content);
    expect(item.category).toBe('feature');
    expect(item.submitter).toBeTruthy();
    expect(item.submitter.id).toBeTruthy();
    expect(item.submitter.phone).toBeTruthy();
  });

  it('admin GET /admin/feedback/:id 详情含 submitter 扩展（email/role/status）', async () => {
    const { status, body } = await apiCall(`/admin/feedback/${feedbackId}`, adminToken);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(feedbackId);
    expect(body.data.images).toEqual([]);
    expect(body.data.submitter).toBeTruthy();
    expect(['CUSTOMER', 'RIDER', 'WAREHOUSE_STAFF', 'SUPER_ADMIN', 'CUSTOMER_SERVICE']).toContain(
      body.data.submitter.role,
    );
    expect(body.data.submitter.status).toBeTruthy();
  });

  it('admin GET /admin/feedback/:missing → 404 E-FEEDBACK-002', async () => {
    const { status, body } = await apiCall(
      `/admin/feedback/nonexistent-${uuid()}`,
      adminToken,
    );
    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('E-FEEDBACK-002');
  });

  it('admin GET /admin/feedback?category=product 筛选：提交的 feature 不命中', async () => {
    const { status, body } = await apiCall(
      `/admin/feedback?category=product&keyword=${encodeURIComponent(content.slice(0, 16))}`,
      adminToken,
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const found = body.data.items.find((it: any) => it.id === feedbackId);
    expect(found).toBeUndefined();
  });

  it('admin GET /admin/feedback?category=feature 筛选：提交的 feature 命中', async () => {
    const { status, body } = await apiCall(
      `/admin/feedback?category=feature&keyword=${encodeURIComponent(content.slice(0, 16))}`,
      adminToken,
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const found = body.data.items.find((it: any) => it.id === feedbackId);
    expect(found).toBeTruthy();
  });
});
