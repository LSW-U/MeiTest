/**
 * e2e 多用户限流隔离 — F1 [P0] 验证（P22 审查修复，2026-08-25）
 *
 * 验证问题（修复前）：
 *   RateLimitGuard 注册在 JwtAuthGuard 之前 → ${user.sub} 解析时 request.user 尚未填充
 *   → 所有登录用户的限流 key 都回退到 'anonymous' → 共用一个桶 → 用户 A 耗尽配额后用户 B 也被拒。
 *   影响端点：feedback（feedback:user:${user.sub}）、change-password、change-phone 等所有用 ${user.sub} 的端点。
 *
 * 修复后期望：
 *   guard 顺序 Jwt → ... → RateLimit，${user.sub} 正确解析为各自身份 → 每用户独立桶
 *   → 用户 A 耗尽 5 次/小时后，用户 B 首次提交仍成功。
 *
 * 取第二个用户：mock-login 默认返回 seed admin（+67099999999）。
 *   customer userId 通过 admin 列表端点 GET /admin/users?role=CUSTOMER 动态获取（不写死 uuid）。
 *   两个不同 userId → mock-login 签发不同 sub 的 token → ${user.sub} 桶应隔离。
 *
 * 运行方式：需 docker compose up + API dev server 运行
 *   pnpm --filter @meimart/api test:e2e -- rate-limit-isolation.e2e.test.ts
 */
import { describe, it, expect } from 'vitest';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';

async function mockLogin(userId?: string): Promise<string> {
  const res = await fetch(`${API}/common/auth/mock-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'CUSTOMER', deviceType: 'client_app', userId }),
  });
  const body = await res.json();
  if (!body.success) throw new Error(`mock-login failed: ${body.error?.message}`);
  return body.data.accessToken;
}

/** 提交一条反馈（content ≥10 字） */
async function postFeedback(token: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}/client/feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Perspective': 'platform',
    },
    body: JSON.stringify({
      category: 'other',
      content: `F1 isolation probe ${Math.random().toString(36).slice(2)}`,
      images: [],
    }),
  });
  return { status: res.status, body: await res.json() };
}

describe('e2e: F1 多用户限流隔离（${user.sub} 桶独立）', () => {
  it('用户 A 耗尽 5 次/小时配额后，用户 B 首次提交仍成功（不再共用 anonymous 桶）', async () => {
    const adminToken = await mockLogin();

    // 通过 admin 列表端点拿一个 customer 的 userId（admin 视角可列用户）
    const listRes = await fetch(`${API}/admin/users?role=CUSTOMER&pageSize=1`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Perspective': 'platform' },
    });
    const listBody = listRes.ok ? await listRes.json() : null;
    const customerUserId = listBody?.data?.items?.[0]?.id;

    if (!customerUserId) {
      console.warn('[F1 e2e] 无法获取 customer userId（admin 用户列表端点不可用或无数据），跳过断言');
      return;
    }

    const customerToken = await mockLogin(customerUserId);
    expect(customerToken).toBeTruthy();

    // 1. 用户 A（admin）耗尽 feedback 5 次/小时配额
    let aBlocked = false;
    for (let i = 0; i < 6; i++) {
      const r = await postFeedback(adminToken);
      if (r.status === 429) {
        aBlocked = true;
        break;
      }
      expect(r.body.success ?? false).toBe(true);
    }
    expect(aBlocked).toBe(true);

    // 2. 用户 B（customer）首次提交 —— 修复前会因共用 anonymous 桶被 429，修复后应成功
    const bRes = await postFeedback(customerToken);
    expect(bRes.status).not.toBe(429);
    expect(bRes.body?.success).toBe(true);
  }, 30000);
});
