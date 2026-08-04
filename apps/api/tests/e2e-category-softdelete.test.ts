/**
 * e2e 分类软删 → 客户端树不可见（审查观察②，2026-08-04）
 *
 * 验证 listCategoryTree 的 ACTIVE 过滤端到端生效：
 *   1. admin 建分类（默认 ACTIVE）
 *   2. GET /client/categories 能见到它
 *   3. DELETE 软删（status -> INACTIVE）
 *   4. GET /client/categories 见不到它
 *
 * 运行方式：需要 docker compose up + API dev server 运行
 *   pnpm --filter @meimart/api test:e2e tests/e2e-category-softdelete.test.ts
 *
 * 注意：真 HTTP（localhost:3000），不走 NestJS DI。软删的分类以 INACTIVE 留库
 * （客户端树过滤掉），不影响后续测试。
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

/** 从客户端树（嵌套 roots + children）展平所有 id */
function flattenTree(tree: any[]): string[] {
  const ids: string[] = [];
  for (const node of tree ?? []) {
    ids.push(node.id);
    for (const child of node.children ?? []) ids.push(child.id);
  }
  return ids;
}

// ============ tests ============

describe('e2e: 分类软删后客户端树不可见', () => {
  let adminToken: string;
  let categoryId: string;
  const marker = `e2e-del-${uuid().slice(0, 8)}`;

  it('准备：admin 登录 + 建一个顶级分类', async () => {
    adminToken = await mockLogin('SUPER_ADMIN', 'admin_web');

    const res = await apiCall('/admin/categories', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        name: { en: marker, zh: '', id: '', pt: '', tet: '' },
        iconUrl: '',
      }),
    });
    expect(res.success).toBe(true);
    expect(res.data.id).toBeTruthy();
    expect(res.data.status).toBe('ACTIVE'); // create 永远默认 ACTIVE（观察①）
    categoryId = res.data.id;
  });

  it('软删前：GET /client/categories 能见到该分类', async () => {
    const res = await apiCall('/client/categories', adminToken);
    expect(res.success).toBe(true);
    const ids = flattenTree(res.data);
    expect(ids).toContain(categoryId);
  });

  it('DELETE 软删该分类 -> success', async () => {
    const res = await apiCall(`/admin/categories/${categoryId}`, adminToken, {
      method: 'DELETE',
    });
    expect(res.success).toBe(true);
  });

  it('软删后：GET /client/categories 见不到该分类（ACTIVE 过滤生效）', async () => {
    const res = await apiCall('/client/categories', adminToken);
    expect(res.success).toBe(true);
    const ids = flattenTree(res.data);
    expect(ids).not.toContain(categoryId);
  });
});
